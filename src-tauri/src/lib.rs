mod auth;
mod cli;
mod commands;
mod db;

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
        ])
        .run(tauri::generate_context!())
        .expect("failed to start SF DevKit");
}
