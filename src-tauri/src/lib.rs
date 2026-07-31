mod auth;
mod cli;
mod commands;
mod db;
mod deployer;
mod log_viewer;
mod metadata;
mod schema;
#[cfg(target_os = "macos")]
mod tray;

use db::DbState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let pool = db::init::init_db(app.handle())?;
            app.manage(DbState(pool));
            #[cfg(target_os = "macos")]
            tray::build_tray(app.handle())?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            #[cfg(target_os = "macos")]
            {
                tray::on_menu_event(app, event);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app, event);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::export::save_export_file,
            commands::export::open_in_editor,
            commands::org::sync_orgs,
            commands::org::list_orgs,
            commands::org::update_org_alias,
            commands::org::reauthorize_org,
            commands::org::set_default_org,
            commands::org::logout_org,
            commands::org::login_org,
            commands::org::cancel_login,
            commands::org::open_org,
            commands::org::pick_project_directory,
            commands::org::set_org_linked_project_path,
            commands::org::open_org_linked_project_in_ide,
            commands::org::update_tray_labels,
            commands::schema::get_objects,
            commands::schema::get_fields,
            commands::schema::get_child_relationships,
            commands::schema::get_picklist_values,
            commands::schema::refresh_schema_cache,
            commands::soql::run_soql_query,
            commands::metadata::list_metadata_types,
            commands::metadata::list_metadata_components,
            commands::metadata::retrieve_metadata,
            commands::metadata::cancel_retrieve,
            commands::metadata::list_retrieve_history,
            commands::metadata::reveal_in_finder,
            commands::log_viewer::list_apex_logs,
            commands::log_viewer::download_apex_log,
            commands::log_viewer::download_latest_self_log,
            commands::log_viewer::open_in_vscode,
            commands::log_viewer::reveal_log_file,
            commands::log_viewer::get_current_user,
            commands::log_viewer::search_users,
            commands::log_viewer::find_apex_class_id,
            commands::log_viewer::search_apex_classes,
            commands::log_viewer::ensure_debug_level,
            commands::log_viewer::enable_trace,
            commands::log_viewer::renew_trace,
            commands::log_viewer::disable_trace,
            commands::log_viewer::pick_log_output_directory,
            commands::apex::run_apex,
            commands::deployer::deploy_metadata,
            commands::deployer::check_package_xml,
            commands::deployer::cancel_deploy,
            commands::deployer::quick_deploy,
            commands::deployer::list_deploy_history,
            commands::deployer::list_quick_deploys,
            commands::deployer::retrieve_for_diff,
            commands::deployer::open_diff_tool,
            commands::deployer::search_apex_test_classes,
            commands::deployer::scan_local_test_classes,
            commands::dashboard::open_external,
            commands::dashboard::fetch_feed,
            commands::dashboard::pick_app_path,
            commands::update::check_for_updates,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start SF DevKit");
}
