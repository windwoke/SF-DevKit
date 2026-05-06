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

#[tauri::command]
pub async fn login_org(state: State<'_, DbState>) -> Result<Vec<OrgAuth>, String> {
    manager::login_org(&state.0)
        .await
        .map_err(|e| e.to_string())
}
