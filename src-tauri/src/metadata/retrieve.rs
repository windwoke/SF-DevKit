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
        output_name: Option<&str>,
        output_mode: &str,
        api_version: &str,
        event_id: &str,
    ) -> anyhow::Result<RetrieveResult> {
        let output_name = build_output_name(org_alias, output_name)?;
        let target_output_path = PathBuf::from(output_dir).join(if output_mode == "zip" {
            format!("{output_name}.zip")
        } else {
            output_name.clone()
        });
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
        cmd.env("PATH", crate::cli::environment::runtime_path());

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
            let target =
                reserve_output_path(output_dir, &output_name, output_mode == "zip").await?;
            if output_mode == "zip" {
                let internal_zip = internal_output_dir.join("retrieve.zip");
                tokio::fs::copy(&internal_zip, &target).await?;
            } else {
                // Copy the entire .sfdevkit-output contents (same structure as diff retrieve)
                copy_dir_recursive(&internal_output_dir, &target).await?;
                tokio::fs::write(target.join("package.xml"), package_xml.as_bytes()).await?;
            }
            target.to_string_lossy().into_owned()
        } else {
            target_output_path.to_string_lossy().into_owned()
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

fn build_output_name(org_alias: &str, custom_name: Option<&str>) -> anyhow::Result<String> {
    if let Some(name) = custom_name.map(str::trim).filter(|name| !name.is_empty()) {
        let device = name
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_uppercase();
        if name == "."
            || name == ".."
            || name.ends_with('.')
            || name
                .chars()
                .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
            || ["CON", "PRN", "AUX", "NUL"].contains(&device.as_str())
            || (device.len() == 4
                && (device.starts_with("COM") || device.starts_with("LPT"))
                && matches!(device.as_bytes()[3], b'1'..=b'9'))
        {
            anyhow::bail!("RETRIEVE_INVALID_OUTPUT_NAME");
        }
        return Ok(name.to_owned());
    }
    let alias: String = org_alias
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let prefix = if alias.is_empty() { "retrieve" } else { &alias };
    Ok(format!("{prefix}-{}", build_output_token()))
}

/// Atomically reserve an unused destination, including when two retrieves
/// finish at the same time. Existing directories and archives stay intact.
async fn reserve_output_path(output_dir: &str, name: &str, zip: bool) -> anyhow::Result<PathBuf> {
    tokio::fs::create_dir_all(output_dir).await?;
    for index in 1_u64.. {
        let stem = if index == 1 {
            name.to_owned()
        } else {
            format!("{name}-{index}")
        };
        let path = PathBuf::from(output_dir).join(if zip { format!("{stem}.zip") } else { stem });
        let result = if zip {
            tokio::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .await
                .map(|_| ())
        } else {
            tokio::fs::create_dir(&path).await
        };
        match result {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.into()),
        }
    }
    unreachable!()
}

#[cfg(test)]
mod output_name_tests {
    use super::*;

    #[test]
    fn supports_custom_unicode_names_and_keeps_automatic_names_when_blank() {
        assert_eq!(
            build_output_name("Dev", Some("  发布备份 2026-11-05  ")).unwrap(),
            "发布备份 2026-11-05"
        );
        for value in [None, Some(""), Some("   ")] {
            assert!(build_output_name("Dev / One", value)
                .unwrap()
                .starts_with("Dev___One-"));
            assert!(build_output_name("", value)
                .unwrap()
                .starts_with("retrieve-"));
        }
    }

    #[test]
    fn rejects_paths_and_names_that_are_invalid_on_supported_platforms() {
        for value in [
            ".",
            "..",
            "../outside",
            "/tmp/output",
            "a/b",
            "a\\b",
            "C:\\output",
            "bad:name",
            "bad*name",
            "bad?name",
            "bad\"name",
            "bad<name",
            "bad>name",
            "bad|name",
            "bad\nname",
            "name.",
            "CON",
            "con.txt",
            "NUL",
            "COM1",
            "LPT9.zip",
        ] {
            assert_eq!(
                build_output_name("Dev", Some(value))
                    .unwrap_err()
                    .to_string(),
                "RETRIEVE_INVALID_OUTPUT_NAME",
                "{value}"
            );
        }
    }

    #[tokio::test]
    async fn repeated_and_concurrent_retrieves_never_reuse_existing_outputs() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().to_str().unwrap();
        for zip in [false, true] {
            let first = reserve_output_path(dir, "Release", zip).await.unwrap();
            let sentinel = if zip {
                first.clone()
            } else {
                first.join("keep.txt")
            };
            tokio::fs::write(&sentinel, "original").await.unwrap();
            let (second, third) = tokio::join!(
                reserve_output_path(dir, "Release", zip),
                reserve_output_path(dir, "Release", zip),
            );
            let second = second.unwrap();
            let third = third.unwrap();
            assert_ne!(first, second);
            assert_ne!(first, third);
            assert_ne!(second, third);
            assert_eq!(
                first.file_name().unwrap(),
                if zip { "Release.zip" } else { "Release" }
            );
            assert!(second.exists() && third.exists());
            assert_eq!(
                tokio::fs::read_to_string(sentinel).await.unwrap(),
                "original"
            );
        }
    }
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
        let status = Command::new("kill")
            .suppress_console()
            .args(["-TERM", &pid.to_string()])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消 retrieve 失败");
        }
    }
    Ok(())
}
