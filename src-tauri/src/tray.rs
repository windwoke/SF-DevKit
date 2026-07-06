//! macOS-only menu bar (status bar) tray icon.
//!
//! Provides quick access to common SF DevKit actions without activating the
//! main window. The first menu entry is a submenu that lists all known orgs
//! and opens the chosen one in the default browser via `sf org open`.
//!
//! On non-macOS targets this module compiles down to no-ops so the rest of
//! the app is unaffected.

use tauri::{
    image::Image,
    menu::{CheckMenuItem, MenuBuilder, MenuItem, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use crate::DbState;

const TRAY_ID: &str = "main";

/// Build and register the tray icon. Called once during app setup.
pub fn build_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let menu = tauri::async_runtime::block_on(build_menu(app))?;
    let icon = load_tray_icon();
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip("SF DevKit")
        .menu(&menu)
        .build(app)?;
    Ok(())
}

/// Load the macOS template PNG (22×22 black + alpha). Bundled at compile time.
fn load_tray_icon() -> Image<'static> {
    let bytes = include_bytes!("../icons/tray-icon.png");
    Image::from_bytes(bytes).expect("tray-icon.png must be valid PNG")
}

/// Re-read org list from SQLite and rebuild the tray menu.
/// Called after sync_orgs / set_default_org / logout_org so the menu stays in
/// sync with the database.
pub async fn rebuild_menu(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    let menu = build_menu(app).await?;
    tray.set_menu(Some(menu))?;
    Ok(())
}

async fn build_menu(app: &AppHandle<Wry>) -> tauri::Result<tauri::menu::Menu<Wry>> {
    let pool = app.state::<DbState>().0.clone();
    let orgs = crate::auth::manager::list_orgs(&pool)
        .await
        .map_err(tauri::Error::Anyhow)?;

    let mut sub_builder = SubmenuBuilder::with_id(app, "open-orgs", "打开 Org");

    // Default org at top, with a checkmark.
    let default_org = orgs.iter().find(|o| o.is_default == 1).cloned();
    if let Some(def) = &default_org {
        let label = format!("默认：{}", def.alias.as_deref().unwrap_or(&def.id));
        let check = CheckMenuItem::with_id(
            app,
            format!("open::{}", def.id),
            label,
            true,
            true,
            None::<&str>,
        )?;
        sub_builder = sub_builder.item(&check);
    } else {
        let placeholder = MenuItem::with_id(app, "no-default", "未设置默认 Org", false, None::<&str>)?;
        sub_builder = sub_builder.item(&placeholder);
    }

    // All other orgs.
    let others: Vec<_> = orgs.iter().filter(|o| o.is_default != 1).collect();
    if !others.is_empty() {
        sub_builder = sub_builder.separator();
        for o in others {
            let label = format!(
                "{}  ·  {}",
                o.alias.as_deref().unwrap_or(&o.id),
                o.org_type
            );
            let item = MenuItem::with_id(app, format!("open::{}", o.id), label, true, None::<&str>)?;
            sub_builder = sub_builder.item(&item);
        }
    }

    // No orgs at all.
    if orgs.is_empty() {
        sub_builder = sub_builder.separator();
        let item = MenuItem::with_id(
            app,
            "no-orgs",
            "暂无 Org，请先在主窗口登录",
            false,
            None::<&str>,
        )?;
        sub_builder = sub_builder.item(&item);
    }

    let submenu = sub_builder.build()?;

    let show_main = MenuItem::with_id(app, "show-main", "显示主窗口", true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh-orgs", "刷新 Org 列表", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 SF DevKit", true, None::<&str>)?;

    MenuBuilder::new(app)
        .item(&submenu)
        .separator()
        .item(&show_main)
        .item(&refresh)
        .separator()
        .item(&quit)
        .build()
}

/// Unified handler attached via `tauri::Builder::on_menu_event`.
pub fn on_menu_event(app: &AppHandle<Wry>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();

    if let Some(username) = id.strip_prefix("open::") {
        let username = username.to_string();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = crate::auth::manager::open_org(&username).await {
                eprintln!("[tray] open org failed: {e}");
                return;
            }
            // Refresh so last_used ordering updates.
            let _ = rebuild_menu(&app).await;
        });
        return;
    }

    match id {
        "show-main" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        "refresh-orgs" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let pool = app.state::<DbState>().0.clone();
                if let Err(e) = crate::auth::manager::sync_orgs(&pool).await {
                    eprintln!("[tray] sync_orgs failed: {e}");
                }
                let _ = rebuild_menu(&app).await;
            });
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}
