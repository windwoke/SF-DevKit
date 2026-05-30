use std::collections::{HashMap, HashSet};

use sqlx::SqlitePool;

use crate::cli::runner::run_command;
use crate::metadata::groups::get_type_group;
use crate::metadata::models::{ComponentMeta, MetadataTypeMeta};

/// 标记该 org 的 types 列表已按 childXmlNames 展开逻辑重建，避免长期命中无子类型的旧缓存。
const META_KEY_TYPES_CHILDREN_V2: &str = "metadata_types_children_v2";

/// Salesforce 中 folder-based 类型（EmailTemplate, Report 等）的未归档公共文件夹
const UNFILED_PUBLIC_FOLDER: &str = "unfiled$public";

/// 正常 `sf org list metadata-types` 下，这些父类型在解析 `childXmlNames` 后一定会出现对应子类型行。
/// 若 SQLite 里只有父、没有子，且所有行的 `parent_xml_name` 都为空，则多为「打了 v2 标记却从未写入子行」的损坏缓存，不能信任 marker。
const EXPECTED_PARENT_CHILD_PAIRS: &[(&str, &str)] = &[
    ("CustomObject", "CustomField"),
    ("CustomLabels", "CustomLabel"),
    ("ExternalDataSource", "ExternalDataSrcDescriptor"),
];

fn cache_likely_missing_child_expansion(cached: &[MetadataTypeMeta]) -> bool {
    let names: HashSet<&str> = cached.iter().map(|r| r.xml_name.as_str()).collect();
    EXPECTED_PARENT_CHILD_PAIRS
        .iter()
        .any(|(parent, child)| names.contains(parent) && !names.contains(child))
}

pub struct MetadataService {
    pool: SqlitePool,
}

impl MetadataService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn get_types(
        &self,
        org_id: &str,
        force_refresh: bool,
    ) -> anyhow::Result<Vec<MetadataTypeMeta>> {
        eprintln!("[metadata.service] get_types enter org_id={} force_refresh={}", org_id, force_refresh);

        if force_refresh {
            sqlx::query("DELETE FROM metadata_types WHERE org_id = ?1")
                .bind(org_id)
                .execute(&self.pool)
                .await?;
            sqlx::query(
                "DELETE FROM metadata_cache_meta WHERE org_id = ?1 AND cache_key = ?2",
            )
            .bind(org_id)
            .bind(META_KEY_TYPES_CHILDREN_V2)
            .execute(&self.pool)
            .await?;
        }

        if !force_refresh {
            let cached = sqlx::query_as::<_, MetadataTypeMeta>(
                r#"
                SELECT
                    xml_name,
                    directory_name,
                    suffix,
                    CAST(in_folder AS INTEGER) AS in_folder,
                    COALESCE(group_name, '') AS group_name,
                    parent_xml_name
                FROM metadata_types
                WHERE org_id = ?1
                  AND datetime(last_synced, '+24 hours') > datetime('now')
                ORDER BY xml_name
                "#,
            )
            .bind(org_id)
            .fetch_all(&self.pool)
            .await?;
            eprintln!("[metadata.service] get_types cache rows={}", cached.len());
            if !cached.is_empty() {
                let has_child = cached.iter().any(|r| r.parent_xml_name.is_some());
                if has_child {
                    return Ok(attach_groups(cached));
                }
                let marker: Option<i32> = sqlx::query_scalar(
                    "SELECT value_int FROM metadata_cache_meta WHERE org_id = ?1 AND cache_key = ?2",
                )
                .bind(org_id)
                .bind(META_KEY_TYPES_CHILDREN_V2)
                .fetch_optional(&self.pool)
                .await?;
                let missing_expected = cache_likely_missing_child_expansion(&cached);
                if marker == Some(1) && !missing_expected {
                    // 已由 v2 逻辑拉取过且 describe 下无独立子类型行（极少见）
                    return Ok(attach_groups(cached));
                }
                eprintln!(
                    "[metadata.service] get_types invalidate stale types cache org_id={} reason={}",
                    org_id,
                    if missing_expected {
                        "expected child xml rows absent (ignore v2 marker)"
                    } else {
                        "no child rows, no v2 marker"
                    }
                );
                sqlx::query("DELETE FROM metadata_types WHERE org_id = ?1")
                    .bind(org_id)
                    .execute(&self.pool)
                    .await?;
                sqlx::query(
                    "DELETE FROM metadata_cache_meta WHERE org_id = ?1 AND cache_key = ?2",
                )
                .bind(org_id)
                .bind(META_KEY_TYPES_CHILDREN_V2)
                .execute(&self.pool)
                .await?;
            }
        }

        let output = run_command(&["org", "list", "metadata-types", "--target-org", org_id], true).await?;
        eprintln!(
            "[metadata.service] get_types cli stdout_len={} stderr_len={} exit={}",
            output.stdout.len(),
            output.stderr.len(),
            output.exit_code
        );
        let parsed = parse_cli_json(&output.stdout)?;
        let list = parsed["result"]["metadataObjects"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("解析 metadata types 失败"))?;

        let mut declared: HashSet<String> = HashSet::new();
        let mut rows: Vec<MetadataTypeMeta> = Vec::new();

        for item in list {
            let xml_name = item["xmlName"].as_str().unwrap_or_default().to_string();
            if xml_name.is_empty() {
                continue;
            }
            declared.insert(xml_name.clone());
            let directory_name = item["directoryName"].as_str().map(str::to_string);
            let suffix = item["suffix"].as_str().map(str::to_string);
            let in_folder = item["inFolder"].as_bool().unwrap_or(false);
            let meta_file = item["metaFile"].as_bool().unwrap_or(true);
            let group_name = get_type_group(&xml_name).to_string();

            sqlx::query(
                r#"
                INSERT INTO metadata_types
                    (org_id, xml_name, directory_name, suffix, in_folder, group_name, meta_file, parent_xml_name, last_synced)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, datetime('now'))
                ON CONFLICT(org_id, xml_name) DO UPDATE SET
                    directory_name = excluded.directory_name,
                    suffix = excluded.suffix,
                    in_folder = excluded.in_folder,
                    group_name = excluded.group_name,
                    meta_file = excluded.meta_file,
                    parent_xml_name = NULL,
                    last_synced = datetime('now')
                "#,
            )
            .bind(org_id)
            .bind(&xml_name)
            .bind(&directory_name)
            .bind(&suffix)
            .bind(if in_folder { 1_i64 } else { 0_i64 })
            .bind(&group_name)
            .bind(if meta_file { 1_i64 } else { 0_i64 })
            .execute(&self.pool)
            .await?;

            rows.push(MetadataTypeMeta {
                xml_name,
                directory_name,
                suffix,
                in_folder,
                group_name,
                parent_xml_name: None,
            });
        }

        for item in list {
            let parent_xml = item["xmlName"].as_str().unwrap_or_default().to_string();
            if parent_xml.is_empty() {
                continue;
            }
            let Some(children) = item
                .get("childXmlNames")
                .or_else(|| item.get("childXMLNames"))
                .and_then(|v| v.as_array())
            else {
                continue;
            };
            for c in children {
                let Some(child_name) = c.as_str() else {
                    continue;
                };
                if child_name.is_empty() {
                    continue;
                }
                if declared.contains(child_name) {
                    continue;
                }
                declared.insert(child_name.to_string());
                let group_name = get_type_group(child_name).to_string();

                sqlx::query(
                    r#"
                    INSERT INTO metadata_types
                        (org_id, xml_name, directory_name, suffix, in_folder, group_name, meta_file, parent_xml_name, last_synced)
                    VALUES (?1, ?2, NULL, NULL, 0, ?3, 1, ?4, datetime('now'))
                    ON CONFLICT(org_id, xml_name) DO UPDATE SET
                        group_name = excluded.group_name,
                        parent_xml_name = excluded.parent_xml_name,
                        last_synced = datetime('now')
                    "#,
                )
                .bind(org_id)
                .bind(child_name)
                .bind(&group_name)
                .bind(&parent_xml)
                .execute(&self.pool)
                .await?;

                rows.push(MetadataTypeMeta {
                    xml_name: child_name.to_string(),
                    directory_name: None,
                    suffix: None,
                    in_folder: false,
                    group_name,
                    parent_xml_name: Some(parent_xml.clone()),
                });
            }
        }

        eprintln!("[metadata.service] get_types fetched types={}", rows.len());

        sqlx::query(
            r#"
            INSERT INTO metadata_cache_meta (org_id, cache_key, value_int)
            VALUES (?1, ?2, 1)
            ON CONFLICT(org_id, cache_key) DO UPDATE SET value_int = excluded.value_int
            "#,
        )
        .bind(org_id)
        .bind(META_KEY_TYPES_CHILDREN_V2)
        .execute(&self.pool)
        .await?;

        Ok(attach_groups(rows))
    }

    pub async fn get_components(
        &self,
        org_id: &str,
        metadata_type: &str,
        force_refresh: bool,
    ) -> anyhow::Result<Vec<ComponentMeta>> {
        eprintln!(
            "[metadata.service] get_components enter org_id={} type={} force_refresh={}",
            org_id, metadata_type, force_refresh
        );
        if !force_refresh {
            let cached = sqlx::query_as::<_, ComponentMeta>(
                r#"
                SELECT full_name, file_name, last_modified, created_by_name
                FROM metadata_components
                WHERE org_id = ?1
                  AND metadata_type = ?2
                  AND datetime(last_synced, '+10 minutes') > datetime('now')
                ORDER BY full_name
                "#,
            )
            .bind(org_id)
            .bind(metadata_type)
            .fetch_all(&self.pool)
            .await?;
            eprintln!(
                "[metadata.service] get_components cache rows={} org_id={} type={}",
                cached.len(), org_id, metadata_type
            );
            if !cached.is_empty() {
                return Ok(cached);
            }
        }

        let in_folder: bool = sqlx::query_scalar::<_, i64>(
            "SELECT in_folder FROM metadata_types WHERE org_id = ?1 AND xml_name = ?2",
        )
        .bind(org_id)
        .bind(metadata_type)
        .fetch_one(&self.pool)
        .await
        .map(|v| v != 0)
        .unwrap_or(false);

        if in_folder {
            return self
                .get_folder_based_components(org_id, metadata_type)
                .await;
        }

        self.get_flat_components(org_id, metadata_type).await
    }

    /// 普通类型：直接 sf org list metadata
    async fn get_flat_components(
        &self,
        org_id: &str,
        metadata_type: &str,
    ) -> anyhow::Result<Vec<ComponentMeta>> {
        let output = run_command(
            &[
                "org",
                "list",
                "metadata",
                "--target-org",
                org_id,
                "--metadata-type",
                metadata_type,
            ],
            true,
        )
        .await?;
        eprintln!(
            "[metadata.service] get_flat_components stdout_len={} exit={} org_id={} type={}",
            output.stdout.len(),
            output.exit_code,
            org_id,
            metadata_type
        );

        let parsed = parse_cli_json(&output.stdout)?;
        let list = parsed["result"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("解析 metadata components 失败"))?;

        self.persist_components(org_id, metadata_type, list).await
    }

    /// folder-based 类型：先通过 {Type}Folder 拿文件夹列表，再逐个文件夹拉组件
    async fn get_folder_based_components(
        &self,
        org_id: &str,
        metadata_type: &str,
    ) -> anyhow::Result<Vec<ComponentMeta>> {
        let folder_type = format!("{}Folder", metadata_type);

        let folder_output = run_command(
            &[
                "org",
                "list",
                "metadata",
                "--target-org",
                org_id,
                "--metadata-type",
                folder_type.as_str(),
            ],
            true,
        )
        .await?;
        eprintln!(
            "[metadata.service] get_folder_based_components folder list stdout_len={} exit={} org_id={} folder_type={}",
            folder_output.stdout.len(),
            folder_output.exit_code,
            org_id,
            folder_type
        );

        let parsed = parse_cli_json(&folder_output.stdout)?;
        let folder_list = parsed["result"].as_array();

        let mut folder_names: Vec<String> = vec![UNFILED_PUBLIC_FOLDER.to_string()];
        if let Some(folders) = folder_list {
            for folder in folders {
                if let Some(name) = folder["fullName"].as_str() {
                    if !name.is_empty() && name != UNFILED_PUBLIC_FOLDER {
                        folder_names.push(name.to_string());
                    }
                }
            }
        }

        let mut all_items: Vec<serde_json::Value> = Vec::new();
        for folder_name in &folder_names {
            eprintln!(
                "[metadata.service] get_folder_based_components fetching folder={} org_id={} type={}",
                folder_name, org_id, metadata_type
            );

            let comp_output = run_command(
                &[
                    "org",
                    "list",
                    "metadata",
                    "--target-org",
                    org_id,
                    "--metadata-type",
                    metadata_type,
                    "--folder",
                    folder_name,
                ],
                true,
            )
            .await?;

            let comp_parsed = match parse_cli_json(&comp_output.stdout) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!(
                        "[metadata.service] get_folder_based_components parse error folder={} err={}",
                        folder_name, e
                    );
                    continue;
                }
            };

            if let Some(items) = comp_parsed["result"].as_array() {
                all_items.extend(items.iter().cloned());
            }
        }

        eprintln!(
            "[metadata.service] get_folder_based_components total_items={} org_id={} type={}",
            all_items.len(),
            org_id,
            metadata_type
        );
        self.persist_components(org_id, metadata_type, &all_items).await
    }

    /// 解析 CLI JSON 结果并持久化到 SQLite，返回组件列表
    async fn persist_components(
        &self,
        org_id: &str,
        metadata_type: &str,
        list: &[serde_json::Value],
    ) -> anyhow::Result<Vec<ComponentMeta>> {
        let mut tx = self.pool.begin().await?;
        let mut out = Vec::with_capacity(list.len());
        let mut seen = HashSet::new();
        for item in list {
            let full_name = item["fullName"].as_str().unwrap_or_default().to_string();
            if full_name.is_empty() {
                continue;
            }
            // sf CLI 偶有重复 full_name，去重避免前端 React key 冲突
            if !seen.insert(full_name.clone()) {
                continue;
            }
            let file_name = item["fileName"].as_str().map(str::to_string);
            let last_modified = item["lastModifiedDate"].as_str().map(str::to_string);
            let created_by_name = item["createdByName"].as_str().map(str::to_string);

            sqlx::query(
                r#"
                INSERT INTO metadata_components
                    (org_id, metadata_type, full_name, file_name, last_modified, created_by_name, last_synced)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
                ON CONFLICT(org_id, metadata_type, full_name) DO UPDATE SET
                    file_name = excluded.file_name,
                    last_modified = excluded.last_modified,
                    created_by_name = excluded.created_by_name,
                    last_synced = datetime('now')
                "#,
            )
            .bind(org_id)
            .bind(metadata_type)
            .bind(&full_name)
            .bind(&file_name)
            .bind(&last_modified)
            .bind(&created_by_name)
            .execute(&mut *tx)
            .await?;

            out.push(ComponentMeta {
                full_name,
                file_name,
                last_modified,
                created_by_name,
            });
        }
        tx.commit().await?;

        eprintln!(
            "[metadata.service] persist_components rows={} org_id={} type={}",
            out.len(), org_id, metadata_type
        );
        Ok(out)
    }
}

fn attach_groups(items: Vec<MetadataTypeMeta>) -> Vec<MetadataTypeMeta> {
    let mut out: Vec<MetadataTypeMeta> = items
        .into_iter()
        .map(|mut item| {
            item.group_name = get_type_group(&item.xml_name).to_string();
            item
        })
        .collect();

    // 子类型在 groups.rs 未单独列出时会落在 Other；若其父类型已有明确分组，则继承父分组
    // （可多轮：父先被提升后，子再在下一轮跟上）。
    for _ in 0..24 {
        let xml_to_group: HashMap<String, String> = out
            .iter()
            .map(|i| (i.xml_name.clone(), i.group_name.clone()))
            .collect();
        let mut changed = false;
        for item in &mut out {
            if item.group_name != "Other" {
                continue;
            }
            let Some(parent) = item.parent_xml_name.as_ref() else {
                continue;
            };
            let Some(g) = xml_to_group.get(parent) else {
                continue;
            };
            if g != "Other" && g.as_str() != item.group_name.as_str() {
                item.group_name.clone_from(g);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    out
}

fn parse_cli_json(stdout: &str) -> anyhow::Result<serde_json::Value> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        anyhow::bail!("CLI 没有返回 JSON 内容");
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(value);
    }

    let first_json_idx = trimmed
        .find('{')
        .or_else(|| trimmed.find('['))
        .ok_or_else(|| anyhow::anyhow!("CLI 输出中未找到 JSON 起始字符"))?;
    let json_part = &trimmed[first_json_idx..];
    eprintln!(
        "[metadata.service] parse_cli_json fallback used, prefix_len={}, total_len={}",
        first_json_idx,
        trimmed.len()
    );
    serde_json::from_str::<serde_json::Value>(json_part)
        .map_err(|e| anyhow::anyhow!("解析 CLI JSON 失败: {}", e))
}
