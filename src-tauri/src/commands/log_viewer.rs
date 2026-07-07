use tauri::State;

use crate::db::DbState;
use crate::log_viewer::models::{ActiveTrace, ApexClassItem, ApexLog, SfUser};
use crate::log_viewer::service;

#[tauri::command]
pub async fn list_apex_logs(
    org_id: String,
    limit: Option<u32>,
    user_filter: Option<String>,
) -> Result<Vec<ApexLog>, String> {
    service::list_apex_logs(&org_id, limit.unwrap_or(50), user_filter.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_apex_log(
    state: State<'_, DbState>,
    org_id: String,
    log_id: String,
    output_dir: String,
    file_name: String,
) -> Result<String, String> {
    service::download_apex_log(&state.0, &org_id, &log_id, &output_dir, &file_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_latest_self_log(
    state: State<'_, DbState>,
    org_id: String,
    current_user_name: String,
    output_dir: String,
) -> Result<Option<String>, String> {
    service::download_latest_self_log(&state.0, &org_id, &current_user_name, &output_dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_in_vscode(file_path: String) -> Result<(), String> {
    service::open_in_vscode(&file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reveal_log_file(file_path: String) -> Result<(), String> {
    service::reveal_log_file(&file_path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_current_user(org_id: String) -> Result<SfUser, String> {
    service::get_current_user(&org_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_users(
    state: State<'_, DbState>,
    org_id: String,
    keyword: String,
) -> Result<Vec<SfUser>, String> {
    service::search_users(&state.0, &org_id, &keyword)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_apex_class_id(org_id: String, class_name: String) -> Result<Option<String>, String> {
    service::find_apex_class_id(&org_id, &class_name)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_apex_classes(org_id: String, keyword: String) -> Result<Vec<ApexClassItem>, String> {
    service::search_apex_classes(&org_id, &keyword)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ensure_debug_level(org_id: String, preset: String) -> Result<String, String> {
    service::ensure_debug_level(&org_id, &preset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn enable_trace(
    state: State<'_, DbState>,
    org_id: String,
    entity_id: String,
    log_type: String,
    debug_level_id: String,
    duration_minutes: u32,
    label: Option<String>,
    kind: Option<String>,
) -> Result<ActiveTrace, String> {
    service::enable_trace(
        &state.0,
        &org_id,
        &entity_id,
        &log_type,
        &debug_level_id,
        duration_minutes,
        label.as_deref().unwrap_or(""),
        kind.as_deref().unwrap_or("UNKNOWN"),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn renew_trace(
    state: State<'_, DbState>,
    org_id: String,
    trace_flag_id: String,
    duration_minutes: u32,
) -> Result<String, String> {
    service::renew_trace(&state.0, &org_id, &trace_flag_id, duration_minutes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn disable_trace(
    state: State<'_, DbState>,
    org_id: String,
    trace_flag_id: String,
) -> Result<(), String> {
    service::disable_trace(&state.0, &org_id, &trace_flag_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_log_output_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned()))
}
