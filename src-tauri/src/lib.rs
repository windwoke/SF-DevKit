mod auth;
mod cli;
mod commands;
mod db;
mod metadata;
mod schema;

use db::DbState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let pool = db::init::init_db(app.handle())?;
            app.manage(DbState(pool));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::export::save_export_file,
            commands::org::sync_orgs,
            commands::org::list_orgs,
            commands::org::set_default_org,
            commands::org::logout_org,
            commands::org::login_org,
            commands::org::open_org,
            commands::org::pick_project_directory,
            commands::org::set_org_linked_project_path,
            commands::org::open_org_linked_project_in_ide,
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
            commands::metadata::reveal_in_finder,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start SF DevKit");
}
