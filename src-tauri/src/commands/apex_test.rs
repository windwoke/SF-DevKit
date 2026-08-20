use tauri::State;

use crate::apex_test::discovery;
use crate::apex_test::models::{ApexPackageScan, ApexTestClass, ApexTestRunResult};
use crate::apex_test::runner;
use crate::db::DbState;

#[tauri::command]
pub async fn list_apex_test_classes(
    state: State<'_, DbState>,
    org_id: String,
    force_refresh: Option<bool>,
) -> Result<Vec<ApexTestClass>, String> {
    discovery::list_org_test_classes(&state.0, &org_id, force_refresh.unwrap_or(false))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn scan_apex_test_package(path: String) -> Result<ApexPackageScan, String> {
    discovery::scan_package(&path).map_err(|e| e.to_string())
}

/// Pick a retrieve package — either a directory or a `.zip` file.
/// macOS folder picker can't filter; try folder first, then file with filter.
#[tauri::command]
pub fn pick_apex_test_package() -> Result<Option<String>, String> {
    if let Some(dir) = rfd::FileDialog::new().pick_folder() {
        return Ok(Some(dir.to_string_lossy().into_owned()));
    }
    Ok(rfd::FileDialog::new()
        .add_filter("Salesforce retrieve package (zip)", &["zip"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
pub async fn run_apex_tests(
    org_id: String,
    class_names: Vec<String>,
) -> Result<ApexTestRunResult, String> {
    runner::run_apex_tests(&org_id, &class_names)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_apex_test_result(
    org_id: String,
    test_run_id: String,
) -> Result<ApexTestRunResult, String> {
    runner::get_apex_test_result(&org_id, &test_run_id)
        .await
        .map_err(|e| e.to_string())
}

/// Start background polling for a submitted test run; streams
/// `polling` / `completed` / `failed` events on `event_id`.
#[tauri::command]
pub async fn poll_apex_test_result(
    app: tauri::AppHandle,
    org_id: String,
    test_run_id: String,
    event_id: String,
) -> Result<ApexTestRunResult, String> {
    runner::poll_apex_test_result(app, &org_id, &test_run_id, &event_id)
        .await
        .map_err(|e| e.to_string())
}
