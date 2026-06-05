use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeployMode {
    Deploy,
    ValidateAndDeploy,
    ValidateOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TestLevel {
    Default,
    NoTestRun,
    RunLocalTests,
    RunSpecifiedTests,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployOptions {
    pub org_id: String,
    pub working_dir: String,
    pub mode: DeployMode,
    pub test_level: TestLevel,
    pub test_classes: Vec<String>,
    pub event_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub success: bool,
    pub deploy_id: Option<String>,
    pub error_count: usize,
    pub component_count: usize,
    pub duration_ms: u64,
    pub errors: Vec<DeployError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployError {
    pub file_name: String,
    pub full_name: String,
    pub component_type: String,
    pub line_number: Option<u32>,
    pub column_number: Option<u32>,
    pub message: String,
    pub error_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RetrieveEvent {
    pub event_type: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct DeployHistoryRecord {
    pub id: i64,
    pub org_id: String,
    pub working_dir: String,
    pub mode: String,
    pub test_level: String,
    pub success: i64,
    pub deploy_id: Option<String>,
    pub component_count: i64,
    pub error_count: i64,
    pub duration_ms: Option<i64>,
    pub errors_json: String,
    pub executed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct QuickDeployRecord {
    pub deploy_id: String,
    pub org_id: String,
    pub working_dir: String,
    pub component_count: i64,
    pub expires_at: String,
    pub used: i64,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ApexClassMeta {
    pub id: String,
    pub name: String,
}
