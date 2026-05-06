use serde_json::Value;
use sqlx::SqlitePool;

use crate::cli::runner::run_command;
use crate::db::models::{ChildRelationship, FieldMeta, ObjectMeta};

pub async fn get_objects(pool: &SqlitePool, org_id: &str) -> anyhow::Result<Vec<ObjectMeta>> {
    let rows = sqlx::query_as::<_, ObjectMeta>(
        r#"
        SELECT api_name, label, is_custom
        FROM schema_objects
        WHERE org_id = ?1
          AND datetime(last_synced, '+24 hours') > datetime('now')
        ORDER BY api_name
        "#,
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    if !rows.is_empty() {
        return Ok(rows);
    }

    fetch_and_cache_objects(pool, org_id).await
}

async fn fetch_and_cache_objects(pool: &SqlitePool, org_id: &str) -> anyhow::Result<Vec<ObjectMeta>> {
    let output = run_command(
        &[
            "sobject",
            "list",
            "--sobject",
            "all",
            "--target-org",
            org_id,
        ],
        true,
    )
    .await?;
    let json: Value = serde_json::from_str(&output.stdout)?;
    let objects = json["result"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("invalid sobject list response"))?;

    let mut result = Vec::new();
    for obj_name in objects {
        let Some(name) = obj_name.as_str() else {
            continue;
        };
        let is_custom = name.ends_with("__c") || name.ends_with("__x");
        let label = name.to_string();

        sqlx::query(
            r#"
            INSERT INTO schema_objects (org_id, api_name, label, is_custom, last_synced)
            VALUES (?1, ?2, ?3, ?4, datetime('now'))
            ON CONFLICT(org_id, api_name) DO UPDATE SET
              label = excluded.label,
              is_custom = excluded.is_custom,
              last_synced = datetime('now')
            "#,
        )
        .bind(org_id)
        .bind(name)
        .bind(&label)
        .bind(if is_custom { 1_i64 } else { 0_i64 })
        .execute(pool)
        .await?;

        result.push(ObjectMeta {
            api_name: name.to_string(),
            label,
            is_custom: if is_custom { 1 } else { 0 },
        });
    }

    Ok(result)
}

pub async fn get_fields(pool: &SqlitePool, org_id: &str, object_name: &str) -> anyhow::Result<Vec<FieldMeta>> {
    let rows = sqlx::query_as::<_, FieldMeta>(
        r#"
        SELECT api_name, label, field_type, reference_to, relationship_name, is_nillable
        FROM schema_fields
        WHERE org_id = ?1 AND object_api_name = ?2
          AND datetime(last_synced, '+24 hours') > datetime('now')
        ORDER BY api_name
        "#,
    )
    .bind(org_id)
    .bind(object_name)
    .fetch_all(pool)
    .await?;

    if !rows.is_empty() {
        return Ok(rows);
    }

    fetch_and_cache_fields(pool, org_id, object_name).await
}

async fn fetch_and_cache_fields(
    pool: &SqlitePool,
    org_id: &str,
    object_name: &str,
) -> anyhow::Result<Vec<FieldMeta>> {
    let output = run_command(
        &[
            "sobject",
            "describe",
            "--sobject",
            object_name,
            "--target-org",
            org_id,
        ],
        true,
    )
    .await?;
    let json: Value = serde_json::from_str(&output.stdout)?;
    let fields = json["result"]["fields"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("invalid describe response"))?;

    let mut result = Vec::new();

    if let Some(children) = json["result"]["childRelationships"].as_array() {
        for ch in children {
            let rel_name = ch["relationshipName"].as_str().unwrap_or_default();
            let child_obj = ch["childSObject"].as_str().unwrap_or_default();
            let fld = ch["field"].as_str().unwrap_or_default();
            if rel_name.is_empty() || child_obj.is_empty() {
                continue;
            }
            sqlx::query(
                r#"
                INSERT INTO schema_child_relationships
                  (org_id, parent_object, relationship_name, child_object, field_name, last_synced)
                VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
                ON CONFLICT(org_id, parent_object, relationship_name) DO UPDATE SET
                  child_object = excluded.child_object,
                  field_name = excluded.field_name,
                  last_synced = datetime('now')
                "#,
            )
            .bind(org_id)
            .bind(object_name)
            .bind(rel_name)
            .bind(child_obj)
            .bind(fld)
            .execute(pool)
            .await?;
        }
    }

    for field in fields {
        let api_name = field["name"].as_str().unwrap_or_default().to_string();
        let label = field["label"].as_str().unwrap_or_default().to_string();
        let field_type = field["type"]
            .as_str()
            .unwrap_or("string")
            .to_uppercase();
        let reference_to = field["referenceTo"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            })
            .filter(|s| !s.is_empty());
        let relationship_name = field["relationshipName"]
            .as_str()
            .map(str::to_string)
            .or_else(|| {
                if field_type == "REFERENCE" {
                    infer_relationship_name(&api_name)
                } else {
                    None
                }
            });
        let is_nillable = field["nillable"].as_bool().unwrap_or(true) as i64;

        sqlx::query(
            r#"
            INSERT INTO schema_fields
              (org_id, object_api_name, api_name, label, field_type, reference_to, relationship_name, is_nillable, last_synced)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, datetime('now'))
            ON CONFLICT(org_id, object_api_name, api_name) DO UPDATE SET
              label = excluded.label,
              field_type = excluded.field_type,
              reference_to = excluded.reference_to,
              relationship_name = excluded.relationship_name,
              is_nillable = excluded.is_nillable,
              last_synced = datetime('now')
            "#,
        )
        .bind(org_id)
        .bind(object_name)
        .bind(&api_name)
        .bind(&label)
        .bind(&field_type)
        .bind(&reference_to)
        .bind(&relationship_name)
        .bind(is_nillable)
        .execute(pool)
        .await?;

        result.push(FieldMeta {
            api_name,
            label,
            field_type,
            reference_to,
            relationship_name,
            is_nillable,
        });
    }

    Ok(result)
}

fn infer_relationship_name(api_name: &str) -> Option<String> {
    if api_name.ends_with("__c") {
        return Some(format!("{}__r", &api_name[..api_name.len() - 3]));
    }
    if api_name.ends_with("Id") && api_name.len() > 2 {
        return Some(api_name[..api_name.len() - 2].to_string());
    }
    None
}

pub async fn get_child_relationships(
    pool: &SqlitePool,
    org_id: &str,
    object_name: &str,
) -> anyhow::Result<Vec<ChildRelationship>> {
    let _ = get_fields(pool, org_id, object_name).await?;

    let rows = sqlx::query_as::<_, ChildRelationship>(
        r#"
        SELECT relationship_name, child_object
        FROM schema_child_relationships
        WHERE org_id = ?1 AND parent_object = ?2
        ORDER BY relationship_name
        "#,
    )
    .bind(org_id)
    .bind(object_name)
    .fetch_all(pool)
    .await?;

    Ok(rows)
}

pub async fn run_soql_query(org_id: &str, query: &str) -> anyhow::Result<Value> {
    eprintln!("[soql] run query org={} sql={}", org_id, query.replace('\n', " "));
    let output = run_command(
        &[
            "data",
            "query",
            "-q",
            query,
            "--target-org",
            org_id,
        ],
        true,
    )
    .await?;
    if !output.stderr.trim().is_empty() {
        eprintln!("[soql] stderr: {}", output.stderr.trim());
    }
    let parsed: Value = serde_json::from_str(&output.stdout).map_err(|e| anyhow::anyhow!(e))?;
    let total = parsed["result"]["totalSize"].as_i64().unwrap_or_default();
    eprintln!("[soql] success totalSize={}", total);
    Ok(parsed)
}
