use std::path::Path;

use sqlx::SqlitePool;

use super::models::ApexClassMeta;

/// Search Apex test classes from the org with SQLite cache (10-min TTL).
/// Delegates to the shared apex_test discovery so Deployer and Apex Test
/// Runner agree on what counts as a test class (`@isTest` / `testMethod`
/// detection on class bodies, not name guessing), then applies a local SQL
/// LIKE search on the cached accurate results.
pub async fn search_apex_test_classes(
    pool: &SqlitePool,
    org_id: &str,
    keyword: &str,
) -> anyhow::Result<Vec<ApexClassMeta>> {
    let classes = crate::apex_test::discovery::list_org_test_classes(pool, org_id, false).await?;

    let needle = keyword.to_lowercase();
    Ok(classes
        .into_iter()
        .filter(|c| c.name.to_lowercase().contains(&needle))
        .take(20)
        .map(|c| ApexClassMeta {
            id: c.id.unwrap_or_default(),
            name: c.name,
        })
        .collect())
}

/// Scan the working directory for Apex test classes.
/// Uses the shared `is_apex_test_class` body detection.
pub fn scan_local_test_classes(working_dir: &str) -> Vec<ApexClassMeta> {
    let root = Path::new(working_dir);
    if !root.is_dir() {
        return vec![];
    }

    let mut classes: Vec<ApexClassMeta> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    fn walk(
        dir: &Path,
        depth: u32,
        classes: &mut Vec<ApexClassMeta>,
        seen: &mut std::collections::HashSet<String>,
    ) {
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
                let is_test = std::fs::read_to_string(&path)
                    .map(|body| crate::apex_test::discovery::is_apex_test_class(&body))
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
