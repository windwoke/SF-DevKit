use tauri::State;

use crate::db::models::RetrieveHistoryRecord;
use crate::db::DbState;
use crate::metadata::models::{ComponentMeta, MetadataTypeMeta, RetrieveResult, SelectionItem};
use crate::metadata::retrieve::RetrieveRunner;
use crate::metadata::service::MetadataService;

#[tauri::command]
pub async fn list_metadata_types(
    state: State<'_, DbState>,
    org_id: String,
    force_refresh: bool,
) -> Result<Vec<MetadataTypeMeta>, String> {
    eprintln!(
        "[metadata] list_metadata_types start org_id={} force_refresh={}",
        org_id, force_refresh
    );
    let svc = MetadataService::new(state.0.clone());
    match svc.get_types(&org_id, force_refresh).await {
        Ok(items) => {
            eprintln!(
                "[metadata] list_metadata_types success org_id={} count={}",
                org_id,
                items.len()
            );
            Ok(items)
        }
        Err(e) => {
            eprintln!(
                "[metadata] list_metadata_types error org_id={} err={}",
                org_id, e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn list_metadata_components(
    state: State<'_, DbState>,
    org_id: String,
    metadata_type: String,
    force_refresh: bool,
) -> Result<Vec<ComponentMeta>, String> {
    eprintln!(
        "[metadata] list_metadata_components start org_id={} type={} force_refresh={}",
        org_id, metadata_type, force_refresh
    );
    let svc = MetadataService::new(state.0.clone());
    match svc
        .get_components(&org_id, &metadata_type, force_refresh)
        .await
    {
        Ok(items) => {
            eprintln!(
                "[metadata] list_metadata_components success org_id={} type={} count={}",
                org_id,
                metadata_type,
                items.len()
            );
            Ok(items)
        }
        Err(e) => {
            eprintln!(
                "[metadata] list_metadata_components error org_id={} type={} err={}",
                org_id, metadata_type, e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn retrieve_metadata(
    app: tauri::AppHandle,
    state: State<'_, DbState>,
    org_id: String,
    org_alias: String,
    selections: Vec<SelectionItem>,
    output_dir: String,
    output_mode: String,
    api_version: String,
    event_id: String,
) -> Result<RetrieveResult, String> {
    let runner = RetrieveRunner::new(state.0.clone());
    runner
        .execute(
            app,
            &org_id,
            &org_alias,
            selections,
            &output_dir,
            &output_mode,
            &api_version,
            &event_id,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_retrieve(event_id: String) -> Result<(), String> {
    RetrieveRunner::cancel(&event_id)
        .await
        .map_err(|e| e.to_string())
}

/// List recent retrieve runs for the dashboard's "Recent Activity" card.
#[tauri::command]
pub async fn list_retrieve_history(
    state: State<'_, DbState>,
    org_id: String,
    limit: Option<u32>,
) -> Result<Vec<RetrieveHistoryRecord>, String> {
    let limit = limit.unwrap_or(10);
    let records = sqlx::query_as::<_, RetrieveHistoryRecord>(
        r#"
        SELECT id, org_id, selections_json, output_dir, api_version,
               output_mode, status, duration_ms, log_text, executed_at
        FROM retrieve_history
        WHERE org_id = ?
        ORDER BY executed_at DESC
        LIMIT ?
        "#,
    )
    .bind(org_id)
    .bind(limit as i64)
    .fetch_all(&state.0)
    .await
    .map_err(|e| e.to_string())?;
    Ok(records)
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    use crate::cli::runner::SuppressConsole;
    use tokio::process::Command;

    #[cfg(target_os = "macos")]
    let status = Command::new("open")
        .suppress_console()
        .args(["-R", &path])
        .status()
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let status = Command::new("explorer")
        .suppress_console()
        .arg(&path)
        .status()
        .await
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open")
        .suppress_console()
        .arg(&path)
        .status()
        .await
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err("无法打开目录".to_string())
    }
}
