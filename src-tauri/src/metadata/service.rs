use sqlx::SqlitePool;

use crate::cli::runner::run_command;
use crate::metadata::groups::get_type_group;
use crate::metadata::models::{ComponentMeta, MetadataTypeMeta};

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
        if !force_refresh {
            let cached = sqlx::query_as::<_, MetadataTypeMeta>(
                r#"
                SELECT
                    xml_name,
                    directory_name,
                    suffix,
                    CAST(in_folder AS INTEGER) AS in_folder,
                    '' AS group_name
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
                return Ok(attach_groups(cached));
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

        let mut types = Vec::with_capacity(list.len());
        for item in list {
            let xml_name = item["xmlName"].as_str().unwrap_or_default().to_string();
            if xml_name.is_empty() {
                continue;
            }
            let directory_name = item["directoryName"].as_str().map(str::to_string);
            let suffix = item["suffix"].as_str().map(str::to_string);
            let in_folder = item["inFolder"].as_bool().unwrap_or(false);
            let meta_file = item["metaFile"].as_bool().unwrap_or(true);

            sqlx::query(
                r#"
                INSERT INTO metadata_types
                    (org_id, xml_name, directory_name, suffix, in_folder, meta_file, last_synced)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
                ON CONFLICT(org_id, xml_name) DO UPDATE SET
                    directory_name = excluded.directory_name,
                    suffix = excluded.suffix,
                    in_folder = excluded.in_folder,
                    meta_file = excluded.meta_file,
                    last_synced = datetime('now')
                "#,
            )
            .bind(org_id)
            .bind(&xml_name)
            .bind(&directory_name)
            .bind(&suffix)
            .bind(if in_folder { 1_i64 } else { 0_i64 })
            .bind(if meta_file { 1_i64 } else { 0_i64 })
            .execute(&self.pool)
            .await?;

            types.push(MetadataTypeMeta {
                xml_name,
                directory_name,
                suffix,
                in_folder,
                group_name: String::new(),
            });
        }

        eprintln!("[metadata.service] get_types fetched types={}", types.len());
        Ok(attach_groups(types))
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
            "[metadata.service] get_components cli stdout_len={} stderr_len={} exit={} org_id={} type={}",
            output.stdout.len(),
            output.stderr.len(),
            output.exit_code,
            org_id,
            metadata_type
        );

        let parsed = parse_cli_json(&output.stdout)?;
        let list = parsed["result"]
            .as_array()
            .ok_or_else(|| anyhow::anyhow!("解析 metadata components 失败"))?;

        let mut out = Vec::with_capacity(list.len());
        for item in list {
            let full_name = item["fullName"].as_str().unwrap_or_default().to_string();
            if full_name.is_empty() {
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
            .execute(&self.pool)
            .await?;

            out.push(ComponentMeta {
                full_name,
                file_name,
                last_modified,
                created_by_name,
            });
        }

        eprintln!(
            "[metadata.service] get_components fetched rows={} org_id={} type={}",
            out.len(), org_id, metadata_type
        );
        Ok(out)
    }
}

fn attach_groups(items: Vec<MetadataTypeMeta>) -> Vec<MetadataTypeMeta> {
    items
        .into_iter()
        .map(|mut item| {
            item.group_name = get_type_group(&item.xml_name).to_string();
            item
        })
        .collect()
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
