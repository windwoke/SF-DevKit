use serde_json::Value;

use crate::schema::cache;

#[tauri::command]
pub async fn run_soql_query(org_id: String, query: String) -> Result<Value, String> {
    cache::run_soql_query(&org_id, &query)
        .await
        .map_err(|e| e.to_string())
}
