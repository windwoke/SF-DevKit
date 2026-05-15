use tauri::State;

use crate::db::DbState;
use crate::deployer::diff;
use crate::deployer::models::{DeployHistoryRecord, DeployOptions, DeployResult, QuickDeployRecord};
use crate::deployer::runner::DeployRunner;
use crate::deployer::test_search;

#[tauri::command]
pub fn check_package_xml(working_dir: String) -> Result<bool, String> {
    let path = std::path::Path::new(&working_dir).join("package.xml");
    Ok(path.exists())
}

#[tauri::command]
pub async fn deploy_metadata(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    options: DeployOptions,
) -> Result<DeployResult, String> {
    let runner = DeployRunner::new(state.0.clone());
    runner.execute(app, &options).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_deploy(event_id: String) -> Result<(), String> {
    DeployRunner::cancel(&event_id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_deploy(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    org_id: String,
    deploy_id: String,
    event_id: String,
) -> Result<DeployResult, String> {
    let runner = DeployRunner::new(state.0.clone());
    runner
        .quick_deploy(app, &org_id, &deploy_id, &event_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_deploy_history(
    state: State<'_, DbState>,
    org_id: String,
    limit: Option<u32>,
) -> Result<Vec<DeployHistoryRecord>, String> {
    let limit = limit.unwrap_or(20);
    DeployRunner::list_history(&state.0, &org_id, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_quick_deploys(
    state: State<'_, DbState>,
    org_id: String,
) -> Result<Vec<QuickDeployRecord>, String> {
    DeployRunner::list_validations(&state.0, &org_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn retrieve_for_diff(
    app: tauri::AppHandle,
    org_id: String,
    working_dir: String,
    event_id: String,
) -> Result<String, String> {
    diff::retrieve_for_diff(app, &org_id, &working_dir, &event_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_diff_tool(command: String) -> Result<(), String> {
    diff::open_diff_tool(&command)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_apex_test_classes(
    state: State<'_, DbState>,
    org_id: String,
    keyword: String,
) -> Result<Vec<crate::deployer::models::ApexClassMeta>, String> {
    test_search::search_apex_test_classes(&state.0, &org_id, &keyword)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_local_test_classes(
    working_dir: String,
) -> Result<Vec<crate::deployer::models::ApexClassMeta>, String> {
    Ok(test_search::scan_local_test_classes(&working_dir))
}
