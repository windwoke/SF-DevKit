use tauri::State;

use crate::auth::manager;
use crate::db::DbState;
use crate::db::models::OrgAuth;

#[tauri::command]
pub async fn sync_orgs(state: State<'_, DbState>) -> Result<Vec<OrgAuth>, String> {
    manager::sync_orgs(&state.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_orgs(state: State<'_, DbState>) -> Result<Vec<OrgAuth>, String> {
    manager::list_orgs(&state.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_default_org(state: State<'_, DbState>, username: String) -> Result<(), String> {
    manager::set_default_org(&state.0, &username)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn logout_org(state: State<'_, DbState>, username: String) -> Result<(), String> {
    manager::logout_org(&state.0, &username)
        .await
        .map_err(|e| e.to_string())
}

/// Browser OAuth only; returns immediately after CLI finishes. Call `sync_orgs` next to refresh DB.
#[tauri::command]
pub async fn login_org(
    alias: Option<String>,
    login_domain: Option<String>,
) -> Result<(), String> {
    manager::login_org_web(alias, login_domain.as_deref().unwrap_or("production"))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_login() -> Result<(), String> {
    manager::cancel_login().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_org(username: String) -> Result<(), String> {
    manager::open_org(&username).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_project_directory() -> Result<Option<String>, String> {
    manager::pick_project_directory().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_org_linked_project_path(
    state: State<'_, DbState>,
    org_id: String,
    path: Option<String>,
) -> Result<(), String> {
    manager::set_org_linked_project_path(&state.0, &org_id, path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_org_linked_project_in_ide(
    state: State<'_, DbState>,
    org_id: String,
) -> Result<(), String> {
    manager::open_org_linked_project_in_ide(&state.0, &org_id)
        .await
        .map_err(|e| e.to_string())
}
