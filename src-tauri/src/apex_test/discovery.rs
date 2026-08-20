//! Shared Apex test-class discovery: org query (with SQLite cache), directory
//! scan, and ZIP scan. All three funnel through [`is_apex_test_class`] so the
//! Deployer and the Apex Test Runner agree on what counts as a test class.

use std::collections::HashSet;
use std::io::Read;
use std::path::Path;

use anyhow::Context;
use sqlx::SqlitePool;

use super::models::{ApexPackageScan, ApexTestClass};

/// TTL for the org ApexClass body cache: 10 minutes (same as metadata_components).
const CLASS_CACHE_TTL_MINUTES: i64 = 10;
/// Max size of a single `.cls` entry read from a ZIP (2 MiB).
const ZIP_ENTRY_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Max total `.cls` bytes read from one ZIP (50 MiB).
const ZIP_TOTAL_MAX_BYTES: u64 = 50 * 1024 * 1024;
/// Directory scan depth guard.
const DIR_SCAN_MAX_DEPTH: u32 = 12;
/// Cap on org query rows accepted per refresh (defensive; orgs are far below this).
const ORG_CLASS_MAX_ROWS: usize = 50_000;

// ---------------------------------------------------------------------------
// is_apex_test_class
// ---------------------------------------------------------------------------

/// Strip `// ...` line comments and `/* ... */` block comments so annotations
/// mentioned only in comments do not fool detection.
fn strip_comments(body: &str) -> String {
    let bytes = body.as_bytes();
    let mut out = String::with_capacity(body.len());
    let mut i = 0;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    while i < bytes.len() {
        let c = bytes[i];
        let next = bytes.get(i + 1).copied();
        if !in_block_comment && !in_line_comment {
            if c == b'/' && next == Some(b'/') {
                in_line_comment = true;
                i += 2;
                continue;
            }
            if c == b'/' && next == Some(b'*') {
                in_block_comment = true;
                i += 2;
                continue;
            }
            out.push(c as char);
            i += 1;
        } else if in_line_comment {
            if c == b'\n' {
                in_line_comment = false;
                out.push('\n');
            }
            i += 1;
        } else {
            // block comment
            if c == b'*' && next == Some(b'/') {
                in_block_comment = false;
                i += 2;
                continue;
            }
            if c == b'\n' {
                out.push('\n');
            }
            i += 1;
        }
    }
    // String literals could still contain "//" sequences that we wrongly
    // treated as comment starts; that is acceptable for a heuristic — an
    // accidental "//" inside a string only drops part of the body from
    // scanning, and `testMethod`/`@isTest` inside a string literal is
    // vanishingly rare in real Apex.
    out
}

/// True if the word appears at `idx` with non-word chars (or edges) around it.
fn is_word_at(body_lower: &str, idx: usize, word: &str) -> bool {
    let bytes = body_lower.as_bytes();
    let end = idx + word.len();
    if end > bytes.len() {
        return false;
    }
    let before_ok = idx == 0 || !is_word_byte(bytes[idx - 1]);
    let after_ok = end == bytes.len() || !is_word_byte(bytes[end]);
    before_ok && after_ok && &body_lower[idx..end] == word
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// Does a body have `@isTest` markers before `{`? Apex allows annotations only
/// on the class/method declaration, so anything after the first `{` cannot be
/// an effective annotation. We still scan the whole comment-stripped body for
/// `testMethod` (legacy keyword) but restrict `@isTest` to the pre-brace part.
fn has_annotation_marker(body: &str) -> bool {
    let head_end = body.find('{').unwrap_or(body.len());
    let head = &body[..head_end];
    let lower = head.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut idx = 0;
    while let Some(pos) = lower[idx..].find("@istest") {
        let abs = idx + pos;
        // The char right after must not continue the word (e.g. not
        // `@isTesty`); the leading `@` is inherently a word boundary.
        let end = abs + "@istest".len();
        let tail_ok = end == bytes.len() || !is_word_byte(bytes[end]);
        if tail_ok {
            return true;
        }
        idx = abs + 1;
    }
    false
}

/// The single source of truth for "is this Apex class body a test class?".
///
/// Recognizes `@isTest` (any casing, with or without arguments), and the legacy
/// `testMethod` keyword. Comments are stripped first; `testMethod` must match
/// on word boundaries so identifiers like `mytestMethodHelper` don't count.
pub fn is_apex_test_class(body: &str) -> bool {
    if body.trim().is_empty() {
        return false;
    }
    let stripped = strip_comments(body);
    if stripped.trim().is_empty() {
        return false;
    }
    if has_annotation_marker(&stripped) {
        return true;
    }
    let lower = stripped.to_ascii_lowercase();
    let mut idx = 0;
    while let Some(pos) = lower[idx..].find("testmethod") {
        let abs = idx + pos;
        if is_word_at(&lower, abs, "testmethod") {
            return true;
        }
        idx = abs + 1;
    }
    false
}

// ---------------------------------------------------------------------------
// Org discovery (Tooling API query + SQLite cache)
// ---------------------------------------------------------------------------

/// Query all ApexClass bodies via the Tooling API and keep only test classes.
async fn fetch_test_classes_from_org(org_id: &str) -> anyhow::Result<Vec<ApexTestClass>> {
    let output = crate::cli::runner::run_command(
        &[
            "data",
            "query",
            "--use-tooling-api",
            "--query",
            "SELECT Id, Name, NamespacePrefix, Body FROM ApexClass ORDER BY Name",
            "--target-org",
            org_id,
        ],
        true,
    )
    .await?;

    if !output.success {
        // Prefer the CLI's structured error message over raw stderr.
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&output.stdout) {
            if let Some(msg) = json
                .pointer("/error/message")
                .or_else(|| json.get("message"))
                .and_then(|v| v.as_str())
            {
                anyhow::bail!("sf data query failed: {}", msg);
            }
        }
        anyhow::bail!("sf data query failed: {}", output.stderr.trim());
    }

    let json: serde_json::Value = serde_json::from_str(&output.stdout)
        .context("failed to parse sf data query output")?;

    let records = json
        .pointer("/result/records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut classes: Vec<ApexTestClass> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for record in records.iter().take(ORG_CLASS_MAX_ROWS) {
        let name = record.get("Name").and_then(|v| v.as_str()).unwrap_or_default();
        let body = record.get("Body").and_then(|v| v.as_str()).unwrap_or_default();
        // Managed-package classes have no readable Body — exclude them.
        if name.is_empty() || body.trim().is_empty() {
            continue;
        }
        if !is_apex_test_class(body) {
            continue;
        }
        let namespace_prefix = record
            .get("NamespacePrefix")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        if seen.insert(sort_key_raw(namespace_prefix.as_deref(), name)) {
            classes.push(ApexTestClass {
                id: record.get("Id").and_then(|v| v.as_str()).map(|s| s.to_string()),
                name: name.to_string(),
                namespace_prefix,
                source: "org".to_string(),
                file_path: None,
                is_test: true,
                member_type: "ApexClass".to_string(),
            });
        }
    }
    classes.sort_by_key(sort_key);
    Ok(classes)
}

fn sort_key(c: &ApexTestClass) -> String {
    sort_key_raw(c.namespace_prefix.as_deref(), &c.name)
}

fn sort_key_raw(namespace_prefix: Option<&str>, name: &str) -> String {
    format!("{}:{}", namespace_prefix.unwrap_or_default(), name)
}

/// List test classes for an org, backed by the shared `apex_class_cache`
/// table (10-min TTL). On refresh the new data is written in a transaction
/// only after a successful fetch, so a CLI failure never wipes a usable cache.
pub async fn list_org_test_classes(
    pool: &SqlitePool,
    org_id: &str,
    force_refresh: bool,
) -> anyhow::Result<Vec<ApexTestClass>> {
    let has_fresh = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*) FROM apex_class_cache
        WHERE org_id = ?
          AND datetime(last_synced, ?) > datetime('now')
        LIMIT 1
        "#,
    )
    .bind(org_id)
    .bind(format!("+{} minutes", CLASS_CACHE_TTL_MINUTES))
    .fetch_one(pool)
    .await?;

    if has_fresh == 0 || force_refresh {
        let classes = fetch_test_classes_from_org(org_id).await?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut tx = pool
            .begin()
            .await
            .context("failed to begin apex_class_cache transaction")?;
        sqlx::query("DELETE FROM apex_class_cache WHERE org_id = ?")
            .bind(org_id)
            .execute(&mut *tx)
            .await?;
        for cls in &classes {
            sqlx::query(
                r#"
                INSERT OR REPLACE INTO apex_class_cache
                  (org_id, name, id, namespace_prefix, is_test, last_synced)
                VALUES (?, ?, ?, ?, 1, ?)
                "#,
            )
            .bind(org_id)
            .bind(&cls.name)
            .bind(cls.id.clone().unwrap_or_default())
            .bind(&cls.namespace_prefix)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit()
            .await
            .context("failed to commit apex_class_cache refresh")?;
        // Cache write done — serve the fresh fetch result directly.
        return Ok(classes);
    }

    let rows = sqlx::query_as::<_, (String, String, Option<String>)>(
        r#"
        SELECT name, id, namespace_prefix FROM apex_class_cache
        WHERE org_id = ? AND is_test = 1
        ORDER BY namespace_prefix, name
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(name, id, namespace_prefix)| ApexTestClass {
            id: if id.is_empty() { None } else { Some(id) },
            name,
            namespace_prefix,
            source: "org".to_string(),
            file_path: None,
            is_test: true,
            member_type: "ApexClass".to_string(),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Directory scan
// ---------------------------------------------------------------------------

fn should_skip_dir_name(name: &str) -> bool {
    name == ".git" || name == "node_modules" || name.starts_with('.')
}

fn has_cls_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("cls"))
        .unwrap_or(false)
}

fn has_trigger_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("trigger"))
        .unwrap_or(false)
}

/// Recursively scan a retrieved directory (SFDX or Metadata API layout) for
/// `.cls` and `.trigger` files. Test classes feed the picker; every class and
/// trigger (test or not) feeds the package coverage view. Unreadable files
/// are skipped.
pub fn scan_directory(path: &str) -> anyhow::Result<ApexPackageScan> {
    let root = Path::new(path);
    if !root.is_dir() {
        anyhow::bail!("not a directory: {}", path);
    }
    let mut classes: Vec<ApexTestClass> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();
    walk_directory(root, 0, &mut classes, &mut seen_paths);

    // Dedup by namespace+name across directories.
    let mut by_key: std::collections::BTreeMap<String, ApexTestClass> =
        std::collections::BTreeMap::new();
    for cls in classes {
        by_key.entry(sort_key(&cls)).or_insert(cls);
    }
    Ok(split_package_scan(by_key.into_values().collect()))
}

/// Split a scanned class list into (test classes, all classes).
fn split_package_scan(classes: Vec<ApexTestClass>) -> ApexPackageScan {
    let test_classes: Vec<ApexTestClass> = classes
        .iter()
        .filter(|c| c.is_test)
        .cloned()
        .collect();
    ApexPackageScan {
        test_classes,
        all_classes: classes,
    }
}

fn walk_directory(
    dir: &Path,
    depth: u32,
    classes: &mut Vec<ApexTestClass>,
    seen_paths: &mut HashSet<String>,
) {
    if depth > DIR_SCAN_MAX_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // unreadable dir — skip, don't fail the scan
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if !should_skip_dir_name(&name) {
                walk_directory(&path, depth + 1, classes, seen_paths);
            }
        } else if has_cls_extension(&path) || has_trigger_extension(&path) {
            let is_trigger = has_trigger_extension(&path);
            let canonical = path.canonicalize().unwrap_or_else(|_| path.clone());
            let canonical_key = canonical.to_string_lossy().to_string();
            if !seen_paths.insert(canonical_key) {
                continue;
            }
            let body = match std::fs::read_to_string(&path) {
                Ok(b) => b,
                Err(_) => continue, // unreadable file — skip
            };
            let is_test = !is_trigger && is_apex_test_class(&body);
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if stem.is_empty() {
                continue;
            }
            classes.push(ApexTestClass {
                id: None,
                name: stem,
                namespace_prefix: None,
                source: "retrieve".to_string(),
                file_path: Some(canonical.to_string_lossy().to_string()),
                is_test,
                member_type: if is_trigger {
                    "ApexTrigger".to_string()
                } else {
                    "ApexClass".to_string()
                },
            });
        }
    }
}

// ---------------------------------------------------------------------------
// ZIP scan
// ---------------------------------------------------------------------------

/// Scan a retrieve ZIP in memory: only `.cls` entries, bounded per-entry and
/// total sizes, nothing written to disk (no Zip Slip surface). Returns test
/// classes plus every class in the package for the coverage view.
pub fn scan_zip(path: &str) -> anyhow::Result<ApexPackageScan> {
    let file = std::fs::File::open(path).with_context(|| format!("failed to open zip: {}", path))?;
    let mut archive = zip::ZipArchive::new(file).context("invalid or corrupted zip file")?;

    let mut classes: Vec<ApexTestClass> = Vec::new();
    let mut total_read: u64 = 0;
    let mut by_key: HashSet<String> = HashSet::new();

    for i in 0..archive.len() {
        let entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue, // skip unreadable entries, don't fail the scan
        };
        if entry.is_dir() {
            continue;
        }
        let entry_name = entry.name().to_string();
        let lower = entry_name.to_ascii_lowercase();
        let is_trigger = lower.ends_with(".trigger");
        if !lower.ends_with(".cls") && !is_trigger {
            continue;
        }
        if entry.size() > ZIP_ENTRY_MAX_BYTES {
            anyhow::bail!(
                "zip entry too large ({} bytes, max {}): {}",
                entry.size(),
                ZIP_ENTRY_MAX_BYTES,
                entry_name
            );
        }
        if total_read + entry.size() > ZIP_TOTAL_MAX_BYTES {
            anyhow::bail!(
                "zip .cls total size exceeds limit ({} bytes)",
                ZIP_TOTAL_MAX_BYTES
            );
        }
        let mut body = String::new();
        // enclose to release the entry borrow before potential bail
        {
            let mut limited = entry.take(ZIP_ENTRY_MAX_BYTES);
            if limited.read_to_string(&mut body).is_err() {
                continue; // non-UTF8 or unreadable — skip this entry
            }
        }
        total_read += body.len() as u64;
        let is_test = !is_trigger && is_apex_test_class(&body);
        // entry name like "classes/FooTest.cls" — use file stem as name
        let stem = std::path::Path::new(&entry_name)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if stem.is_empty() {
            continue;
        }
        if by_key.insert(format!(":{}", stem)) {
            classes.push(ApexTestClass {
                id: None,
                name: stem,
                namespace_prefix: None,
                source: "retrieve".to_string(),
                file_path: Some(entry_name),
                is_test,
                member_type: if is_trigger {
                    "ApexTrigger".to_string()
                } else {
                    "ApexClass".to_string()
                },
            });
        }
    }

    classes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(split_package_scan(classes))
}

/// Unified entry: directory or ZIP based on the path.
pub fn scan_package(path: &str) -> anyhow::Result<ApexPackageScan> {
    let p = Path::new(path);
    if !p.exists() {
        anyhow::bail!("path does not exist: {}", path);
    }
    let is_zip = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("zip"))
        .unwrap_or(false);
    if is_zip {
        scan_zip(path)
    } else if p.is_dir() {
        scan_directory(path)
    } else {
        anyhow::bail!("unsupported package path (expected directory or .zip): {}", path);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_is_test_annotation() {
        assert!(is_apex_test_class("@isTest\nprivate class Foo {\n}"));
    }

    #[test]
    fn detects_is_test_with_arguments() {
        assert!(is_apex_test_class(
            "@IsTest(SeeAllData=true)\npublic class Foo {\n}"
        ));
    }

    #[test]
    fn detects_legacy_test_method() {
        assert!(is_apex_test_class(
            "public class Foo {\n    static testMethod void testOne() {}\n}\n"
        ));
    }

    #[test]
    fn detection_is_case_insensitive() {
        assert!(is_apex_test_class("@ISTEST\npublic class Foo {\n}"));
        assert!(is_apex_test_class(
            "public class Foo {\n    static TestMethod void t() {}\n}\n"
        ));
    }

    #[test]
    fn ignores_is_test_in_line_comment() {
        assert!(!is_apex_test_class(
            "// @isTest mentioned in a comment\npublic class Foo {\n}\n"
        ));
    }

    #[test]
    fn ignores_is_test_in_block_comment() {
        assert!(!is_apex_test_class(
            "/*\n * @isTest(SeeAllData=true)\n */\npublic class Foo {\n}\n"
        ));
    }

    #[test]
    fn annotation_after_brace_does_not_count() {
        // e.g. a string/inner usage — annotation must precede the first `{`
        assert!(!is_apex_test_class(
            "public class Foo {\n    String s = '@isTest';\n}\n"
        ));
    }

    #[test]
    fn plain_class_with_test_in_name_is_not_test() {
        assert!(!is_apex_test_class(
            "public class TestMapper {\n    public void run() {}\n}\n"
        ));
    }

    #[test]
    fn identifier_containing_testmethod_is_not_test() {
        assert!(!is_apex_test_class(
            "public class Foo {\n    Integer mytestMethodCounter = 0;\n}\n"
        ));
    }

    #[test]
    fn empty_body_is_not_test() {
        assert!(!is_apex_test_class(""));
        assert!(!is_apex_test_class("   \n\t  "));
    }

    #[test]
    fn comment_only_body_is_not_test() {
        assert!(!is_apex_test_class("// @isTest\n"));
        assert!(!is_apex_test_class("/* @isTest */\n"));
    }

    #[test]
    fn real_world_style_test_class() {
        let body = r#"
@isTest
private class AccountServiceSpec {
    @isTest
    static void itCreatesAccounts() {
        Account a = new Account(Name = 'x');
        System.assertEquals('x', a.Name);
    }
}
"#;
        assert!(is_apex_test_class(body));
    }

    #[test]
    fn annotation_with_adjacent_word_is_rejected() {
        assert!(!is_apex_test_class("@isTesty\npublic class Foo {\n}"));
    }

    #[test]
    fn scan_directory_finds_test_classes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("AccountServiceTest.cls"),
            "@isTest\nprivate class AccountServiceTest {\n}\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("PlainHelper.cls"),
            "public class PlainHelper {\n}\n",
        )
        .unwrap();
        std::fs::create_dir(dir.path().join("classes")).unwrap();
        std::fs::write(
            dir.path().join("classes").join("OrderSpec.cls"),
            "public class OrderSpec {\n    static testMethod void t() {}\n}\n",
        )
        .unwrap();
        // Skipped dirs
        std::fs::create_dir(dir.path().join(".git")).unwrap();
        std::fs::write(
            dir.path().join(".git").join("HiddenTest.cls"),
            "@isTest\nprivate class HiddenTest {\n}\n",
        )
        .unwrap();

        let scan = scan_directory(dir.path().to_str().unwrap()).unwrap();
        let names: Vec<String> = scan.test_classes.iter().map(|c| c.name.clone()).collect();
        assert!(names.contains(&"AccountServiceTest".to_string()));
        assert!(names.contains(&"OrderSpec".to_string()));
        assert!(!names.contains(&"PlainHelper".to_string()));
        assert!(!names.contains(&"HiddenTest".to_string()));
        assert!(scan.test_classes.iter().all(|c| c.source == "retrieve"));

        // All classes (for coverage view) include the non-test helper.
        let all_names: Vec<String> = scan.all_classes.iter().map(|c| c.name.clone()).collect();
        assert!(all_names.contains(&"PlainHelper".to_string()));
        assert_eq!(all_names.len(), 3);
        assert!(scan.all_classes.iter().all(|c| c.is_test == (c.name != "PlainHelper")));
    }

    #[test]
    fn scan_directory_dedups_duplicate_names() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("a").join("classes")).unwrap();
        std::fs::create_dir_all(dir.path().join("b").join("classes")).unwrap();
        for sub in ["a", "b"] {
            std::fs::write(
                dir.path().join(sub).join("classes").join("DupTest.cls"),
                "@isTest\nprivate class DupTest {\n}\n",
            )
            .unwrap();
        }
        let scan = scan_directory(dir.path().to_str().unwrap()).unwrap();
        let dups: Vec<_> = scan.test_classes.iter().filter(|c| c.name == "DupTest").collect();
        assert_eq!(dups.len(), 1);
    }

    #[test]
    fn scan_directory_empty_when_no_tests() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Plain.cls"), "public class Plain {\n}\n").unwrap();
        let scan = scan_directory(dir.path().to_str().unwrap()).unwrap();
        assert!(scan.test_classes.is_empty());
        // Coverage view still sees the non-test class.
        assert_eq!(scan.all_classes.len(), 1);
        assert_eq!(scan.all_classes[0].name, "Plain");
        assert!(!scan.all_classes[0].is_test);
    }

    #[test]
    fn scan_directory_errors_on_missing_path() {
        assert!(scan_directory("/nonexistent/path/xyz").is_err());
    }

    fn make_zip(path: &std::path::PathBuf, entries: &[(&str, &str)]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            std::io::Write::write_all(&mut zip, content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn scan_zip_finds_test_classes() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("unpackaged.zip");
        make_zip(
            &zip_path,
            &[
                (
                    "unpackaged/classes/FooTest.cls",
                    "@isTest\nprivate class FooTest {\n}\n",
                ),
                (
                    "unpackaged/classes/Plain.cls",
                    "public class Plain {\n}\n",
                ),
                (
                    "unpackaged/package.xml",
                    "<?xml version=\"1.0\"?>\n<Package/>\n",
                ),
            ],
        );
        let scan = scan_zip(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(scan.test_classes.len(), 1);
        assert_eq!(scan.test_classes[0].name, "FooTest");
        assert_eq!(
            scan.test_classes[0].file_path.as_deref(),
            Some("unpackaged/classes/FooTest.cls")
        );
        // Coverage view: both classes.
        assert_eq!(scan.all_classes.len(), 2);
        assert!(scan.all_classes.iter().any(|c| c.name == "Plain" && !c.is_test));
    }

    #[test]
    fn scan_zip_dedups_duplicate_names() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("dup.zip");
        make_zip(
            &zip_path,
            &[
                ("a/DupTest.cls", "@isTest\nclass DupTest {\n}\n"),
                ("b/DupTest.cls", "@isTest\nclass DupTest {\n}\n"),
            ],
        );
        let scan = scan_zip(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(scan.test_classes.len(), 1);
        assert_eq!(scan.all_classes.len(), 1);
    }

    #[test]
    fn scan_zip_empty_when_no_tests() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("plain.zip");
        make_zip(&zip_path, &[("classes/Plain.cls", "public class Plain {}\n")]);
        let scan = scan_zip(zip_path.to_str().unwrap()).unwrap();
        assert!(scan.test_classes.is_empty());
        assert_eq!(scan.all_classes.len(), 1);
    }

    #[test]
    fn scan_zip_rejects_corrupted_file() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("bad.zip");
        std::fs::write(&zip_path, b"this is not a zip file at all").unwrap();
        assert!(scan_zip(zip_path.to_str().unwrap()).is_err());
    }

    #[test]
    fn scan_zip_rejects_missing_file() {
        assert!(scan_zip("/nonexistent/nope.zip").is_err());
    }

    #[test]
    fn scan_zip_rejects_oversized_entry() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("big.zip");
        // 3 MiB body — over the 2 MiB per-entry limit.
        let big = "x".repeat(3 * 1024 * 1024);
        make_zip(&zip_path, &[("classes/Big.cls", &big)]);
        assert!(scan_zip(zip_path.to_str().unwrap()).is_err());
    }

    #[test]
    fn scan_directory_includes_triggers() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("AccountServiceTest.cls"),
            "@isTest\nprivate class AccountServiceTest {\n}\n",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("AccountTrigger.trigger"),
            "trigger AccountTrigger on Account (before insert) {\n}\n",
        )
        .unwrap();
        let scan = scan_directory(dir.path().to_str().unwrap()).unwrap();
        // Triggers are never test classes…
        assert_eq!(scan.test_classes.len(), 1);
        // …but appear in the coverage view with member_type ApexTrigger.
        let trigger = scan
            .all_classes
            .iter()
            .find(|c| c.name == "AccountTrigger")
            .expect("trigger present");
        assert_eq!(trigger.member_type, "ApexTrigger");
        assert!(!trigger.is_test);
        let class = scan
            .all_classes
            .iter()
            .find(|c| c.name == "AccountServiceTest")
            .unwrap();
        assert_eq!(class.member_type, "ApexClass");
    }

    #[test]
    fn scan_zip_includes_triggers() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("p.zip");
        make_zip(
            &zip_path,
            &[
                ("c/FooTest.cls", "@isTest\nclass FooTest {}\n"),
                (
                    "triggers/OpportunityTrigger.trigger",
                    "trigger OpportunityTrigger on Opportunity (before update) {\n}\n",
                ),
            ],
        );
        let scan = scan_zip(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(scan.test_classes.len(), 1);
        assert_eq!(scan.all_classes.len(), 2);
        let trigger = scan
            .all_classes
            .iter()
            .find(|c| c.name == "OpportunityTrigger")
            .expect("trigger present");
        assert_eq!(trigger.member_type, "ApexTrigger");
        assert!(!trigger.is_test);
    }

    #[test]
    fn scan_package_routes_by_extension() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("p.zip");
        make_zip(&zip_path, &[("c/FooTest.cls", "@isTest\nclass FooTest {}\n")]);
        let via_package = scan_package(zip_path.to_str().unwrap()).unwrap();
        assert_eq!(via_package.test_classes.len(), 1);
        let via_dir = scan_package(dir.path().to_str().unwrap()).unwrap();
        assert!(via_dir.test_classes.is_empty());
        assert!(scan_package("/nonexistent/thing").is_err());
    }
}
