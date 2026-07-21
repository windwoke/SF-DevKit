//! macOS-only menu bar (status bar) tray icon.
//!
//! Provides quick access to common SF DevKit actions without activating the
//! main window. The first menu entry is a submenu that lists all known orgs
//! and opens the chosen one in the default browser via `sf org open`.
//!
//! All user-facing strings come from the frontend via [`update_labels`] so
//! the tray follows the same i18n locale as the React UI. On non-macOS
//! targets this module compiles down to no-ops so the rest of the app is
//! unaffected.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{CheckMenuItem, MenuBuilder, MenuItem, SubmenuBuilder},
    tray::TrayIconBuilder,
    AppHandle, Manager, Wry,
};

use crate::DbState;

const TRAY_ID: &str = "main";

/// Localized tray strings. The frontend pushes these via `update_tray_labels`
/// whenever the i18n locale loads or changes.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabels {
    /// Submenu title, e.g. "打开 Org" / "Open Org".
    pub open_orgs_label: String,
    /// Default-org entry, `{name}` is replaced at build time.
    pub default_label_template: String,
    pub no_default: String,
    pub no_orgs: String,
    pub show_main: String,
    pub refresh: String,
    pub quit: String,
    pub tooltip: String,
}

static LABELS: OnceLock<Mutex<TrayLabels>> = OnceLock::new();

fn labels() -> &'static Mutex<TrayLabels> {
    LABELS.get_or_init(|| Mutex::new(fallback_labels()))
}

/// Chinese fallback used before the frontend has pushed real translations
/// (e.g. during the brief window between app launch and React i18n init).
fn fallback_labels() -> TrayLabels {
    TrayLabels {
        open_orgs_label: "打开 Org".into(),
        default_label_template: "默认：{name}".into(),
        no_default: "未设置默认 Org".into(),
        no_orgs: "暂无 Org，请先在主窗口登录".into(),
        show_main: "显示主窗口".into(),
        refresh: "刷新 Org 列表".into(),
        quit: "退出 SF DevKit".into(),
        tooltip: "SF DevKit".into(),
    }
}

/// Replace the in-memory labels and rebuild the menu.
#[cfg(target_os = "macos")]
pub async fn update_labels(app: &AppHandle<Wry>, new_labels: TrayLabels) -> tauri::Result<()> {
    {
        let mut guard = labels()
            .lock()
            .map_err(|_| tauri::Error::Anyhow(anyhow::anyhow!("tray labels 锁不可用")))?;
        *guard = new_labels;
    }
    rebuild_menu(app).await
}

#[cfg(not(target_os = "macos"))]
pub async fn update_labels(_app: &AppHandle<Wry>, _new_labels: TrayLabels) -> tauri::Result<()> {
    Ok(())
}

/// Build and register the tray icon. Called once during app setup.
pub fn build_tray(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let menu = tauri::async_runtime::block_on(build_menu(app))?;
    let tooltip = labels()
        .lock()
        .map(|g| g.tooltip.clone())
        .unwrap_or_default();
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(load_tray_icon())
        .icon_as_template(true)
        .tooltip(tooltip)
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

    let (
        open_orgs_label,
        default_label_template,
        no_default_label,
        no_orgs_label,
        show_main_label,
        refresh_label,
        quit_label,
    ) = labels()
        .lock()
        .map(|g| {
            (
                g.open_orgs_label.clone(),
                g.default_label_template.clone(),
                g.no_default.clone(),
                g.no_orgs.clone(),
                g.show_main.clone(),
                g.refresh.clone(),
                g.quit.clone(),
            )
        })
        .unwrap_or_else(|_| {
            let f = fallback_labels();
            (
                f.open_orgs_label,
                f.default_label_template,
                f.no_default,
                f.no_orgs,
                f.show_main,
                f.refresh,
                f.quit,
            )
        });

    let mut sub_builder = SubmenuBuilder::with_id(app, "open-orgs", open_orgs_label);

    // Default org at top, with a checkmark.
    let default_org = orgs.iter().find(|o| o.is_default == 1).cloned();
    if let Some(def) = &default_org {
        let name = def.alias.as_deref().unwrap_or(&def.id);
        let label = default_label_template.replace("{name}", name);
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
        let placeholder =
            MenuItem::with_id(app, "no-default", no_default_label, false, None::<&str>)?;
        sub_builder = sub_builder.item(&placeholder);
    }

    // All other orgs.
    let others: Vec<_> = orgs.iter().filter(|o| o.is_default != 1).collect();
    if !others.is_empty() {
        sub_builder = sub_builder.separator();
        for o in others {
            let label = format!("{}  ·  {}", o.alias.as_deref().unwrap_or(&o.id), o.org_type);
            let item =
                MenuItem::with_id(app, format!("open::{}", o.id), label, true, None::<&str>)?;
            sub_builder = sub_builder.item(&item);
        }
    }

    // No orgs at all.
    if orgs.is_empty() {
        sub_builder = sub_builder.separator();
        let item = MenuItem::with_id(app, "no-orgs", no_orgs_label, false, None::<&str>)?;
        sub_builder = sub_builder.item(&item);
    }

    let submenu = sub_builder.build()?;

    let show_main = MenuItem::with_id(app, "show-main", show_main_label, true, None::<&str>)?;
    let refresh = MenuItem::with_id(app, "refresh-orgs", refresh_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;

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
