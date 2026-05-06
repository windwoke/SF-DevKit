mod auth;
mod cli;
mod commands;
mod db;
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
            commands::org::sync_orgs,
            commands::org::list_orgs,
            commands::org::set_default_org,
            commands::org::logout_org,
            commands::org::login_org,
            commands::org::open_org,
            commands::schema::get_objects,
            commands::schema::get_fields,
            commands::schema::get_child_relationships,
            commands::schema::get_picklist_values,
            commands::schema::refresh_schema_cache,
            commands::soql::run_soql_query,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start SF DevKit");
}
