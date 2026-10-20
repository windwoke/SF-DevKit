use tauri::{AppHandle, Manager, State};

use crate::auth::{certificates, login, manager, status};
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
    manager::refresh_auth_methods(&state.0)
        .await
        .map_err(|e| e.to_string())?;
    manager::list_orgs(&state.0)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_org_login_status(
    state: State<'_, DbState>,
    username: String,
) -> Result<OrgAuth, String> {
    status::check(&state.0, &username)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_org_alias(
    state: State<'_, DbState>,
    app: AppHandle,
    username: String,
    alias: String,
) -> Result<(), String> {
    manager::update_org_alias(&state.0, &username, &alias)
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
pub async fn reauthorize_org(
    state: State<'_, DbState>,
    app: AppHandle,
    username: String,
    request: login::LoginRequest,
) -> Result<(), String> {
    login::login(&state.0, request, Some(&username))
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
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn update_tray_labels(
    app: AppHandle,
    labels: crate::tray::TrayLabels,
) -> Result<(), String> {
    crate::tray::update_labels(&app, labels)
        .await
        .map_err(|e| e.to_string())
}

/// The frontend shares localized tray labels on every platform. Windows has
/// no native tray menu yet, so accepting the command here keeps that shared
/// frontend path quiet while macOS handles the real menu update above.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn update_tray_labels(_app: AppHandle, _labels: serde_json::Value) -> Result<(), String> {
    Ok(())
}

/// Call `sync_orgs` after either login method to refresh DB and tray state.
#[tauri::command]
pub async fn login_org(
    state: State<'_, DbState>,
    request: login::LoginRequest,
) -> Result<(), String> {
    login::login(&state.0, request, None)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_org_login_profile(
    state: State<'_, DbState>,
    username: String,
) -> Result<Option<login::LoginProfile>, String> {
    login::get_profile(&state.0, &username)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_jwt_key_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("*.key / *.pem", &["key", "pem"])
        .add_filter("*", &["*"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned())
}

fn jwt_storage(app: &AppHandle, directory: Option<String>) -> Result<std::path::PathBuf, String> {
    if let Some(directory) = directory.filter(|directory| !directory.trim().is_empty()) {
        let path = std::path::PathBuf::from(directory);
        if !path.is_absolute() || !path.is_dir() {
            return Err("JWT_CERT_STORAGE_FAILED".into());
        }
        Ok(path)
    } else {
        app.path()
            .app_data_dir()
            .map(|path| path.join("jwt"))
            .map_err(|_| "JWT_CERT_STORAGE_FAILED".into())
    }
}

#[tauri::command]
pub async fn get_jwt_certificate_tools(
    app: AppHandle,
) -> Result<certificates::CertificateTools, String> {
    let _ =
        tauri::async_runtime::spawn_blocking(crate::cli::environment::refresh_runtime_path).await;
    Ok(certificates::tools(&jwt_storage(&app, None)?).await)
}

#[tauri::command]
pub async fn generate_jwt_certificate(
    app: AppHandle,
    common_name: String,
    days: u32,
    directory: Option<String>,
) -> Result<certificates::KeyMaterial, String> {
    certificates::generate(&jwt_storage(&app, directory)?, &common_name, days)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pick_jwt_keystore() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("*.jks / *.p12 / *.pfx", &["jks", "p12", "pfx"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn list_jwt_keystore_entries(
    path: String,
    password: String,
) -> Result<Vec<String>, String> {
    certificates::list_entries(&path, &password)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_jwt_keystore(
    app: AppHandle,
    path: String,
    password: String,
    alias: String,
    key_password: Option<String>,
    directory: Option<String>,
) -> Result<certificates::KeyMaterial, String> {
    certificates::import(
        &jwt_storage(&app, directory)?,
        &path,
        &password,
        &alias,
        key_password.as_deref(),
    )
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn export_jwt_public_certificate(path: String) -> Result<Option<String>, String> {
    let contents = certificates::public_certificate(std::path::Path::new(&path))
        .await
        .map_err(|error| error.to_string())?;
    // File dialogs run outside the async executor, just like other native pickers.
    tauri::async_runtime::spawn_blocking(move || {
        let Some(destination) = rfd::FileDialog::new()
            .set_file_name("server.crt")
            .add_filter("*.crt", &["crt"])
            .save_file()
        else {
            return Ok(None);
        };
        certificates::save_public_certificate(&destination, &contents)
            .map_err(|error| error.to_string())?;
        Ok(Some(destination.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "JWT_CERT_EXPORT_FAILED".to_string())?
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
