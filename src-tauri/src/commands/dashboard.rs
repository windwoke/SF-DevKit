use serde::Deserialize;
use tauri::AppHandle;

/// Pop a native file picker for selecting a local executable / .app bundle
/// when the user adds an "app" kind quick action. Synchronous because rfd
/// runs its own message loop on the main thread.
#[tauri::command]
pub fn pick_app_path() -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_title("Select Application");

    #[cfg(target_os = "macos")]
    {
        dialog = dialog
            .add_filter("Applications", &["app"])
            .add_filter("All Files", &["*"]);
    }
    #[cfg(target_os = "windows")]
    {
        dialog = dialog
            .add_filter("Executables", &["exe", "bat", "cmd"])
            .add_filter("All Files", &["*"]);
    }
    #[cfg(target_os = "linux")]
    {
        dialog = dialog.add_filter("All Files", &["*"]);
    }

    Ok(dialog.pick_file().map(|p| p.to_string_lossy().into_owned()))
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
pub enum OpenTarget {
    #[serde(rename = "url")]
    Url { target: String },
    #[serde(rename = "app")]
    App {
        target: String,
        #[serde(default)]
        args: Option<String>,
    },
    #[serde(rename = "path")]
    Path { target: String },
}

/// Open a URL, launch a local app, or open a local path.
/// Uses platform-native openers (same pattern as `reveal_in_finder`)
/// to avoid the deprecated `shell().open()` API.
#[tauri::command]
pub async fn open_external(_app: AppHandle, target: OpenTarget) -> Result<(), String> {
    use crate::cli::runner::SuppressConsole;
    use tokio::process::Command;

    match target {
        OpenTarget::Url { target } => {
            #[cfg(target_os = "macos")]
            let mut cmd = {
                let mut c = Command::new("open");
                c.arg(&target);
                c
            };
            #[cfg(target_os = "windows")]
            let mut cmd = {
                let mut c = Command::new("cmd");
                c.args(["/C", "start", "", &target]);
                c
            };
            #[cfg(target_os = "linux")]
            let mut cmd = {
                let mut c = Command::new("xdg-open");
                c.arg(&target);
                c
            };
            let status = cmd
                .suppress_console()
                .status()
                .await
                .map_err(|e| format!("open url failed: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err("open url failed".to_string())
            }
        }
        OpenTarget::App { target, args } => {
            #[cfg(target_os = "macos")]
            let mut cmd = {
                let mut c = Command::new("open");
                c.arg("-a").arg(&target);
                if args.as_ref().is_some_and(|value| !value.trim().is_empty()) {
                    c.arg("--args");
                }
                c
            };
            #[cfg(not(target_os = "macos"))]
            let mut cmd = Command::new(&target);

            if let Some(a) = args {
                for part in a.split_whitespace() {
                    cmd.arg(part);
                }
            }

            let status = cmd
                .suppress_console()
                .status()
                .await
                .map_err(|e| format!("launch app failed: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!("launch app failed with status {status}"))
            }
        }
        OpenTarget::Path { target } => {
            if !std::path::Path::new(&target).exists() {
                return Err(format!("path does not exist: {target}"));
            }

            #[cfg(target_os = "macos")]
            let mut cmd = Command::new("open");
            #[cfg(target_os = "windows")]
            let mut cmd = Command::new("explorer");
            #[cfg(target_os = "linux")]
            let mut cmd = Command::new("xdg-open");

            let status = cmd
                .arg(&target)
                .suppress_console()
                .status()
                .await
                .map_err(|e| format!("open path failed: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err("open path failed".to_string())
            }
        }
    }
}

/// Fetch an arbitrary feed/JSON body (RSS, StackExchange API, etc.).
/// Frontend parses the body — backend stays format-agnostic so we can swap
/// news sources without touching Rust.
#[tauri::command]
pub async fn fetch_feed(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        // Some feed CDNs reject unknown fetcher user agents even when the feed
        // is public. Keep a recognized HTTP-client prefix while still
        // identifying SF-DevKit and its version.
        .user_agent(concat!("curl/8.7.1 SF-DevKit/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("http client build failed: {e}"))?;
    let resp = client
        .get(&url)
        .header(
            reqwest::header::ACCEPT,
            "application/rss+xml, application/atom+xml, application/xml, \
             text/xml, application/json, text/html;q=0.8, */*;q=0.5",
        )
        .header(reqwest::header::ACCEPT_LANGUAGE, "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("feed fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("feed fetch status {}", resp.status()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("feed read failed: {e}"))?;
    Ok(body)
}
