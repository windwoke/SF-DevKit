use tauri::{AppHandle, State};

use crate::auth::manager;
use crate::db::models::OrgAuth;
use crate::db::DbState;

#[tauri::command]
pub async fn sync_orgs(state: State<'_, DbState>, app: AppHandle) -> Result<Vec<OrgAuth>, String> {
    let result = manager::sync_orgs(&state.0)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = crate::tray::rebuild_menu(&app).await {
            eprintln!("[tray] rebuild_menu failed: {e}");
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn list_orgs(state: State<'_, DbState>) -> Result<Vec<OrgAuth>, String> {
    manager::list_orgs(&state.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_default_org(
    state: State<'_, DbState>,
    app: AppHandle,
    username: String,
) -> Result<(), String> {
    manager::set_default_org(&state.0, &username)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = crate::tray::rebuild_menu(&app).await {
            eprintln!("[tray] rebuild_menu failed: {e}");
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn logout_org(
    state: State<'_, DbState>,
    app: AppHandle,
    username: String,
) -> Result<(), String> {
    manager::logout_org(&state.0, &username)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = crate::tray::rebuild_menu(&app).await {
            eprintln!("[tray] rebuild_menu failed: {e}");
        }
    }
    Ok(())
}

/// Frontend pushes localized tray strings whenever the i18n locale loads
/// or changes. The Rust side then rebuilds the macOS menu bar menu.
#[tauri::command]
pub async fn update_tray_labels(
    app: AppHandle,
    labels: crate::tray::TrayLabels,
) -> Result<(), String> {
    crate::tray::update_labels(&app, labels)
        .await
        .map_err(|e| e.to_string())
}

/// Browser OAuth only; returns immediately after CLI finishes. Call `sync_orgs` next to refresh DB.
#[tauri::command]
pub async fn login_org(
    alias: Option<String>,
    login_domain: Option<String>,
    instance_url: Option<String>,
    consumer_key: Option<String>,
    consumer_secret: Option<String>,
    port: Option<u16>,
) -> Result<(), String> {
    manager::login_org_web(
        alias,
        login_domain.as_deref().unwrap_or("production"),
        instance_url.as_deref(),
        consumer_key.as_deref(),
        consumer_secret.as_deref(),
        port,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_login() -> Result<(), String> {
    manager::cancel_login().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_org(username: String) -> Result<(), String> {
    manager::open_org(&username)
        .await
        .map_err(|e| e.to_string())
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
