use std::ffi::OsStr;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tokio::process::Command;

use crate::cli::{environment, runner::SuppressConsole};
use crate::db::DbState;

#[derive(Debug, Serialize)]
pub struct EnvironmentCheck {
    id: &'static str,
    status: &'static str,
    path: Option<String>,
    version: Option<String>,
    issue: Option<&'static str>,
    detail: Option<String>,
}

impl EnvironmentCheck {
    fn new(id: &'static str, path: Option<PathBuf>) -> Self {
        Self {
            id,
            status: "ok",
            path: path.map(|p| p.to_string_lossy().into_owned()),
            version: None,
            issue: None,
            detail: None,
        }
    }

    fn fail(mut self, issue: &'static str, detail: Option<String>) -> Self {
        self.status = "error";
        self.issue = Some(issue);
        self.detail = detail;
        self
    }
}

#[derive(Serialize)]
pub struct EnvironmentReport {
    checks: Vec<EnvironmentCheck>,
    checked_at: String,
    search_path: String,
}

fn node_supported(version: &str) -> bool {
    version
        .trim()
        .strip_prefix('v')
        .and_then(|v| v.split('.').next())
        .and_then(|v| v.parse::<u32>().ok())
        .is_some_and(|major| major >= 20)
}

async fn probe_tool(id: &'static str, binary: Option<PathBuf>, path: &OsStr) -> EnvironmentCheck {
    let check = EnvironmentCheck::new(id, binary.clone());
    let Some(binary) = binary else {
        return check.fail("missing", None);
    };
    let mut command = Command::new(binary);
    command
        .suppress_console()
        .arg("--version")
        .env("PATH", path)
        .env("SF_AUTOUPDATE_DISABLE", "true")
        .env("SF_DISABLE_TELEMETRY", "true")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let output = match tokio::time::timeout(Duration::from_secs(15), command.output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => return check.fail("launchFailed", Some(error.to_string())),
        Err(_) => return check.fail("timeout", None),
    };
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let detail = format!("{}\n{}", stdout.trim(), stderr.trim());
        return check.fail(
            "launchFailed",
            Some(detail.trim().chars().take(2000).collect()),
        );
    }
    let version = stdout
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();
    if version.is_empty() {
        return check.fail("launchFailed", Some(stderr.chars().take(2000).collect()));
    }
    let mut check = check;
    check.version = Some(version.chars().take(250).collect());
    if id == "node" && !node_supported(version) {
        return check.fail("unsupportedVersion", None);
    }
    check
}

#[tauri::command]
pub async fn check_environment(
    app: AppHandle,
    state: State<'_, DbState>,
) -> Result<EnvironmentReport, String> {
    // Shell initialization may take time: keep it off the async executor and UI.
    let path = tokio::task::spawn_blocking(environment::refresh_runtime_path)
        .await
        .map_err(|e| e.to_string())?;
    let node = environment::find_on_path("node", &path);
    let sf = crate::cli::runner::find_sf();
    let (mut node, cli) = tokio::join!(
        probe_tool("node", node, &path),
        probe_tool("salesforceCli", sf, &path),
    );
    // Standalone Salesforce CLI installations can provide their own Node runtime.
    // A successful CLI probe is the authority for whether CLI features can run.
    if node.status == "error" && cli.status == "ok" {
        node.status = "warning";
        node.issue = Some("cliAvailable");
    }
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut storage = EnvironmentCheck::new("storage", Some(directory.clone()));
    let write_result = tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new_in(directory)?;
        file.write_all(b"SF DevKit environment check")?;
        file.as_file().sync_all()
    })
    .await
    .map_err(|e| e.to_string())?;
    if let Err(error) = write_result {
        storage = storage.fail("storageUnavailable", Some(error.to_string()));
    } else {
        match tokio::time::timeout(
            Duration::from_secs(5),
            sqlx::query("SELECT 1").execute(&state.0),
        )
        .await
        {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => storage = storage.fail("storageUnavailable", Some(error.to_string())),
            Err(_) => storage = storage.fail("timeout", None),
        }
    }
    Ok(EnvironmentReport {
        checks: vec![node, cli, storage],
        checked_at: chrono::Utc::now().to_rfc3339(),
        search_path: path.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_node_baseline() {
        assert!(node_supported("v24.18.0"));
        assert!(node_supported("v20.0.0\n"));
        assert!(!node_supported("v18.20.0"));
        assert!(!node_supported("not a version"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn existing_but_broken_cli_fails_the_check() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let sf = dir.path().join("sf");
        std::fs::write(&sf, "#!/usr/bin/env sf-devkit-missing-node\n").unwrap();
        std::fs::set_permissions(&sf, std::fs::Permissions::from_mode(0o755)).unwrap();
        let check = probe_tool("salesforceCli", Some(sf), OsStr::new("/usr/bin:/bin")).await;
        assert_eq!(check.status, "error");
        assert_eq!(check.issue, Some("launchFailed"));
        assert!(check.detail.unwrap().contains("sf-devkit-missing-node"));
    }

    #[tokio::test]
    async fn missing_tool_has_an_actionable_result() {
        let check = probe_tool("node", None, OsStr::new("")).await;
        assert_eq!(check.issue, Some("missing"));
        assert_eq!(check.status, "error");
    }
}
