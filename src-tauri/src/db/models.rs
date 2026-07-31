use serde::Serialize;
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct OrgAuth {
    pub id: String,
    pub alias: Option<String>,
    pub instance_url: String,
    pub org_type: String,
    pub is_default: i64,
    pub expires_at: Option<String>,
    pub connection_status: String,
    pub last_used: Option<String>,
    /// Local workspace folder associated with this org (optional).
    pub linked_project_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct RetrieveHistoryRecord {
    pub id: i64,
    pub org_id: String,
    pub selections_json: String,
    pub output_dir: String,
    pub api_version: String,
    pub output_mode: String,
    pub status: String,
    pub duration_ms: Option<i64>,
    pub log_text: Option<String>,
    pub executed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ObjectMeta {
    pub api_name: String,
    pub label: String,
    pub is_custom: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FieldMeta {
    pub api_name: String,
    pub label: String,
    pub field_type: String,
    pub reference_to: Option<String>,
    pub relationship_name: Option<String>,
    pub is_nillable: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ChildRelationship {
    pub relationship_name: String,
    pub child_object: String,
}
