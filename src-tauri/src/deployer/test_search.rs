use std::path::Path;

use anyhow::Context;
use sqlx::SqlitePool;

use super::models::ApexClassMeta;

/// TTL: 10 minutes (same as metadata_components)
const CLASS_CACHE_TTL_MINUTES: i64 = 10;

/// Fetch all ApexClass components from org via `sf org list metadata --metadata-type ApexClass`.
/// Returns list of { name, id } objects (id is the Salesforce Id of the ApexClass).
async fn fetch_classes_from_org(org_id: &str) -> anyhow::Result<Vec<ApexClassMeta>> {
    let output = crate::cli::runner::run_command(
        &[
            "org", "list", "metadata",
            "--metadata-type", "ApexClass",
            "--target-org", org_id,
            "--json",
        ],
        true,
    )
    .await?;

    if !output.success {
        anyhow::bail!("获取 ApexClass 列表失败: {}", output.stderr);
    }

    let json: serde_json::Value =
        serde_json::from_str(&output.stdout).context("解析 CLI 输出失败")?;

    let classes = json["result"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| {
                    let name = v.get("fullName").and_then(|n| n.as_str())?;
                    let id = v.get("id").and_then(|n| n.as_str())?;
                    Some(ApexClassMeta {
                        id: id.to_string(),
                        name: name.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(classes)
}

/// Search Apex test classes from default org with SQLite cache (10-min TTL).
/// Matches Metadata Browser's metadata_components caching pattern exactly:
/// - Uses `sf org list metadata --metadata-type ApexClass` CLI command
/// - SQLite cache with TTL
/// - Local SQL LIKE search on cached names
pub async fn search_apex_test_classes(
    pool: &SqlitePool,
    org_id: &str,
    keyword: &str,
) -> anyhow::Result<Vec<ApexClassMeta>> {
    // Check if we have a fresh cache for this org
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

    // Cache miss — fetch all classes from org via CLI
    if has_fresh == 0 {
        // Clear stale entries for this org
        sqlx::query("DELETE FROM apex_class_cache WHERE org_id = ?")
            .bind(org_id)
            .execute(pool)
            .await?;

        let classes = fetch_classes_from_org(org_id).await?;
        if !classes.is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            for cls in &classes {
                sqlx::query(
                    "INSERT OR REPLACE INTO apex_class_cache (org_id, name, id, last_synced) VALUES (?, ?, ?, ?)",
                )
                .bind(org_id)
                .bind(&cls.name)
                .bind(&cls.id)
                .bind(&now)
                .execute(pool)
                .await?;
            }
        }
    }

    // Search in local SQLite cache
    let results = sqlx::query_as::<_, ApexClassMeta>(
        r#"
        SELECT name, id FROM apex_class_cache
        WHERE org_id = ? AND name LIKE '%' || ? || '%'
        ORDER BY name LIMIT 20
        "#,
    )
    .bind(org_id)
    .bind(keyword)
    .fetch_all(pool)
    .await?;

    Ok(results)
}

/// Scan the working directory for Apex test classes.
/// Looks for `.cls` files in any subdirectory (max depth 6).
/// A file is considered a test class if its name contains "Test"
/// or its body contains `@isTest` / `@IsTest`.
pub fn scan_local_test_classes(working_dir: &str) -> Vec<ApexClassMeta> {
    let root = Path::new(working_dir);
    if !root.is_dir() {
        return vec![];
    }

    let mut classes: Vec<ApexClassMeta> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    fn walk(dir: &Path, depth: u32, classes: &mut Vec<ApexClassMeta>, seen: &mut std::collections::HashSet<String>) {
        if depth > 6 {
            return;
        }
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };
        for entry in entries.filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, depth + 1, classes, seen);
            } else if path.extension().and_then(|s| s.to_str()) == Some("cls") {
                let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                if seen.contains(stem) {
                    continue;
                }
                let is_test = stem.contains("Test")
                    || std::fs::read_to_string(&path)
                        .map(|body| body.contains("@isTest") || body.contains("@IsTest"))
                        .unwrap_or(false);
                if is_test {
                    seen.insert(stem.to_string());
                    classes.push(ApexClassMeta {
                        id: String::new(),
                        name: stem.to_string(),
                    });
                }
            }
        }
    }

    walk(root, 0, &mut classes, &mut seen);
    classes.sort_by(|a, b| a.name.cmp(&b.name));
    classes
}
