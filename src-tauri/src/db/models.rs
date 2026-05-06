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
    pub last_used: Option<String>,
}
