use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexLog {
    pub id: String,
    pub application: String,
    pub duration_millis: i64,
    pub location: String,
    pub log_user_name: String,
    pub operation: String,
    pub request: String,
    pub size: i64,
    pub start_time: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SfUser {
    pub id: String,
    pub name: String,
    pub username: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApexClassItem {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveTrace {
    pub trace_flag_id: String,
    pub entity_id: String,
    pub log_type: String,
    pub expires_at: String,
}
