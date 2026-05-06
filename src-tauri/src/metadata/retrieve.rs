use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::metadata::models::{RetrieveEvent, RetrieveResult, SelectionItem};
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
        tokio::fs::write(&pkg_path, package_xml).await?;

        let sf_path = which::which("sf")
            .or_else(|_| which::which("sfdx"))
            .map_err(|_| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

        let mut cmd = Command::new(&sf_path);
        cmd.args([
            "project",
            "retrieve",
            "start",
            "--target-org",
            org_id,
            "--manifest",
            &pkg_path.to_string_lossy(),
            "--output-dir",
            output_dir,
            "--api-version",
            api_version,
        ]);
        if output_mode == "zip" {
            cmd.arg("--zip-file-name").arg("retrieve.zip");
        }
        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

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
                data: format!("开始 retrieve，共 {} 个组件", component_count),
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
                            log_buf.push_str(&text);
                            log_buf.push('\n');
                            let _ = app.emit(event_id, RetrieveEvent {
                                event_type: "stdout".to_string(),
                                data: text,
                            });
                        }
                        None => break,
                    }
                }
                line = err_lines.next_line() => {
                    if let Some(text) = line? {
                        log_buf.push_str(&text);
                        log_buf.push('\n');
                        let _ = app.emit(event_id, RetrieveEvent {
                            event_type: "stderr".to_string(),
                            data: text,
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

        let output_path = if output_mode == "zip" {
            format!("{}/retrieve.zip", output_dir.trim_end_matches('/'))
        } else {
            output_dir.to_string()
        };

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

async fn kill_process(pid: u32) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消 retrieve 失败");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("kill").args(["-TERM", &pid.to_string()]).status().await?;
        if !status.success() {
            anyhow::bail!("取消 retrieve 失败");
        }
    }
    Ok(())
}
