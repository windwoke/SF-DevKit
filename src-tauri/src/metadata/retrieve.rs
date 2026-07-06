use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use chrono::Local;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::cli::runner::SuppressConsole;
use crate::metadata::models::{RetrieveEvent, RetrieveResult, SelectionItem};

fn strip_ansi(text: &str) -> String {
    String::from_utf8(strip_ansi_escapes::strip(text)).unwrap_or_else(|_| text.to_string())
}
use crate::metadata::package_xml::generate_package_xml;

static ACTIVE_RETRIEVES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

fn active_retrieves() -> &'static Mutex<HashMap<String, u32>> {
    ACTIVE_RETRIEVES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct RetrieveRunner {
    pool: SqlitePool,
}

impl RetrieveRunner {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn execute(
        &self,
        app: AppHandle,
        org_id: &str,
        org_alias: &str,
        selections: Vec<SelectionItem>,
        output_dir: &str,
        output_mode: &str,
        api_version: &str,
        event_id: &str,
    ) -> anyhow::Result<RetrieveResult> {
        let started_at = Instant::now();
        let component_count = selections.iter().map(|s| s.members.len()).sum();

        let tmp_dir = std::env::temp_dir();
        let pkg_path = tmp_dir.join(format!("sfdevkit-{}-package.xml", event_id));
        let package_xml = generate_package_xml(&selections, api_version);
        tokio::fs::write(&pkg_path, package_xml.as_bytes()).await?;

        let sf_path = crate::cli::runner::find_sf()
            .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;
        let workspace = prepare_temp_sfdx_workspace(event_id).await?;
        let internal_output_dir = workspace.join(".sfdevkit-output");
        let internal_output_arg = ".sfdevkit-output";
        tokio::fs::create_dir_all(&internal_output_dir).await?;
        let output_token = build_output_token();
        let safe_alias: String = org_alias
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect();
        let prefix = if safe_alias.is_empty() { "retrieve".to_string() } else { safe_alias };
        let target_extract_dir = PathBuf::from(output_dir).join(format!("{}-{}", prefix, output_token));
        let target_zip_file = PathBuf::from(output_dir).join(format!("{}-{}.zip", prefix, output_token));

        let mut cmd = Command::new(&sf_path);
        cmd.suppress_console();
        cmd.args([
            "project",
            "retrieve",
            "start",
            "--target-org",
            org_id,
            "--manifest",
            &pkg_path.to_string_lossy(),
            "--api-version",
            api_version,
        ]);
        // sf CLI v2.138+ requires --target-metadata-dir when using --zip-file-name,
        // and that mdapi-mode flag is mutually exclusive with --output-dir.
        // So we branch on output_mode:
        //   - zip    → mdapi zip at .sfdevkit-output/retrieve.zip (CLI's native zip)
        //   - extract → source-format files under .sfdevkit-output/
        if output_mode == "zip" {
            cmd.args(["--target-metadata-dir", internal_output_arg])
                .args(["--zip-file-name", "retrieve.zip"]);
        } else {
            cmd.args(["--output-dir", internal_output_arg]);
        }
        cmd.current_dir(&workspace);
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Inject PATH for bundled macOS apps
        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
        if !current_path.contains("/opt/homebrew") {
            cmd.env("PATH", format!("{}:{}", extra, current_path));
        }

        let mut child = cmd.spawn()?;
        if let Some(pid) = child.id() {
            let mut guard = active_retrieves()
                .lock()
                .map_err(|_| anyhow::anyhow!("retrieve 状态锁不可用"))?;
            guard.insert(event_id.to_string(), pid);
        }

        let _ = app.emit(
            event_id,
            RetrieveEvent {
                event_type: "start".to_string(),
                data: format!(
                    "开始 retrieve，共 {} 个组件；工作目录: {}；目标输出: {}",
                    component_count,
                    workspace.to_string_lossy(),
                    output_dir
                ),
            },
        );

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 retrieve stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 retrieve stderr"))?;
        let mut out_lines = BufReader::new(stdout).lines();
        let mut err_lines = BufReader::new(stderr).lines();
        let mut log_buf = String::new();

        loop {
            tokio::select! {
                line = out_lines.next_line() => {
                    match line? {
                        Some(text) => {
                            let clean = strip_ansi(&text);
                            log_buf.push_str(&clean);
                            log_buf.push('\n');
                            let _ = app.emit(event_id, RetrieveEvent {
                                event_type: "stdout".to_string(),
                                data: clean,
                            });
                        }
                        None => break,
                    }
                }
                line = err_lines.next_line() => {
                    if let Some(text) = line? {
                        let clean = strip_ansi(&text);
                        log_buf.push_str(&clean);
                        log_buf.push('\n');
                        let _ = app.emit(event_id, RetrieveEvent {
                            event_type: "stderr".to_string(),
                            data: clean,
                        });
                    }
                }
            }
        }

        let status = child.wait().await?;
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let success = status.success();
        let exit_code = status.code().unwrap_or(-1);

        {
            let mut guard = active_retrieves()
                .lock()
                .map_err(|_| anyhow::anyhow!("retrieve 状态锁不可用"))?;
            guard.remove(event_id);
        }

        let _ = app.emit(
            event_id,
            RetrieveEvent {
                event_type: "exit".to_string(),
                data: format!("退出码: {}", exit_code),
            },
        );

        let selections_json = serde_json::to_string(&selections)?;
        let status_text = if success { "success" } else { "failed" };
        sqlx::query(
            r#"
            INSERT INTO retrieve_history
                (org_id, selections_json, output_dir, api_version, output_mode, status, duration_ms, log_text)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )
        .bind(org_id)
        .bind(selections_json)
        .bind(output_dir)
        .bind(api_version)
        .bind(output_mode)
        .bind(status_text)
        .bind(duration_ms as i64)
        .bind(log_buf)
        .execute(&self.pool)
        .await?;

        let output_path = if success {
            if output_mode == "zip" {
                let internal_zip = internal_output_dir.join("retrieve.zip");
                tokio::fs::create_dir_all(output_dir).await?;
                tokio::fs::copy(&internal_zip, &target_zip_file).await?;
                target_zip_file.to_string_lossy().into_owned()
            } else {
                tokio::fs::create_dir_all(&target_extract_dir).await?;
                // Copy the entire .sfdevkit-output contents (same structure as diff retrieve)
                copy_dir_recursive(&internal_output_dir, &target_extract_dir).await?;
                tokio::fs::write(target_extract_dir.join("package.xml"), package_xml.as_bytes()).await?;
                target_extract_dir.to_string_lossy().into_owned()
            }
        } else {
            if output_mode == "zip" {
                target_zip_file.to_string_lossy().into_owned()
            } else {
                target_extract_dir.to_string_lossy().into_owned()
            }
        };
        let _ = tokio::fs::remove_dir_all(&workspace).await;

        Ok(RetrieveResult {
            success,
            output_path,
            duration_ms,
            component_count,
        })
    }

    pub async fn cancel(event_id: &str) -> anyhow::Result<()> {
        let pid = {
            let mut guard = active_retrieves()
                .lock()
                .map_err(|_| anyhow::anyhow!("retrieve 状态锁不可用"))?;
            guard.remove(event_id)
        };
        if let Some(pid) = pid {
            kill_process(pid).await?;
        }
        Ok(())
    }
}

async fn prepare_temp_sfdx_workspace(event_id: &str) -> anyhow::Result<PathBuf> {
    let workspace = std::env::temp_dir().join(format!("sfdevkit-retrieve-workspace-{}", event_id));
    tokio::fs::create_dir_all(&workspace).await?;
    tokio::fs::create_dir_all(workspace.join("force-app")).await?;
    let project_json = r#"{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true
    }
  ],
  "namespace": "",
  "sourceApiVersion": "62.0"
}"#;
    tokio::fs::write(workspace.join("sfdx-project.json"), project_json).await?;
    Ok(workspace)
}

fn build_output_token() -> String {
    Local::now().format("%Y%m%d-%H%M%S-%3f").to_string()
}

async fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> anyhow::Result<()> {
    let mut stack: Vec<(PathBuf, PathBuf)> = vec![(src.clone(), dst.clone())];

    while let Some((from_dir, to_dir)) = stack.pop() {
        tokio::fs::create_dir_all(&to_dir).await?;
        let mut entries = tokio::fs::read_dir(&from_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            let src_path = entry.path();
            let dst_path = to_dir.join(entry.file_name());
            let file_type = entry.file_type().await?;
            if file_type.is_dir() {
                stack.push((src_path, dst_path));
            } else if file_type.is_file() {
                tokio::fs::copy(src_path, dst_path).await?;
            }
        }
    }
    Ok(())
}

async fn dir_has_entries(path: &PathBuf) -> anyhow::Result<bool> {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return Ok(false);
    };
    if !meta.is_dir() {
        return Ok(false);
    }
    let mut entries = tokio::fs::read_dir(path).await?;
    Ok(entries.next_entry().await?.is_some())
}

async fn kill_process(pid: u32) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .suppress_console()
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消 retrieve 失败");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("kill").suppress_console().args(["-TERM", &pid.to_string()]).status().await?;
        if !status.success() {
            anyhow::bail!("取消 retrieve 失败");
        }
    }
    Ok(())
}
