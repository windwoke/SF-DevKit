use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use chrono::Utc;
use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::models::{
    DeployError, DeployHistoryRecord, DeployMode, DeployOptions, DeployResult, QuickDeployRecord,
    RetrieveEvent, TestLevel,
};

fn strip_ansi(text: &str) -> String {
    String::from_utf8(strip_ansi_escapes::strip(text)).unwrap_or_else(|_| text.to_string())
}

static ACTIVE_DEPLOYS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();

fn active_deploys() -> &'static Mutex<HashMap<String, u32>> {
    ACTIVE_DEPLOYS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub struct DeployRunner {
    pool: SqlitePool,
}

impl DeployRunner {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn execute(
        &self,
        app: AppHandle,
        options: &DeployOptions,
    ) -> anyhow::Result<DeployResult> {
        let started_at = Instant::now();
        let pkg_xml = format!("{}/package.xml", options.working_dir);

        // Build CLI args
        let mut args: Vec<String> = vec![
            "project".into(),
            "deploy".into(),
            "start".into(),
            "--manifest".into(),
            pkg_xml.clone(),
            "--target-org".into(),
            options.org_id.clone(),
            "--wait".into(),
            "60".into(),
            "--json".into(),
        ];

        if matches!(options.mode, DeployMode::ValidateOnly) {
            args.push("--dry-run".into());
        }
        // Deploy mode: no special flags, just deploy directly

        let test_level_str = match options.test_level {
            TestLevel::NoTestRun => "NoTestRun",
            TestLevel::RunLocalTests => "RunLocalTests",
            TestLevel::RunSpecifiedTests => "RunSpecifiedTests",
        };
        args.extend(["--test-level".into(), test_level_str.into()]);

        let test_classes_str;
        if matches!(options.test_level, TestLevel::RunSpecifiedTests)
            && !options.test_classes.is_empty()
        {
            test_classes_str = options.test_classes.join(",");
            args.extend(["--tests".into(), test_classes_str.clone()]);
        }

        let sf_path = which::which("sf")
            .or_else(|_| which::which("sfdx"))
            .map_err(|_| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

        let mut cmd = Command::new(&sf_path);
        cmd.args(&args);
        cmd.current_dir(&options.working_dir);
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
            let mut guard = active_deploys()
                .lock()
                .map_err(|_| anyhow::anyhow!("deploy 状态锁不可用"))?;
            guard.insert(options.event_id.clone(), pid);
        }

        let mode_label = match options.mode {
            DeployMode::Deploy => "直接部署",
            DeployMode::ValidateAndDeploy => "部署",
            DeployMode::ValidateOnly => "验证",
        };
        let _ = app.emit(
            &options.event_id,
            RetrieveEvent {
                event_type: "start".to_string(),
                data: format!(
                    "开始{}，工作目录: {}，目标 Org: {}，测试级别: {}",
                    mode_label, options.working_dir, options.org_id, test_level_str
                ),
            },
        );

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 deploy stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 deploy stderr"))?;
        let mut out_lines = BufReader::new(stdout).lines();
        let mut err_lines = BufReader::new(stderr).lines();
        let mut stdout_buf = String::new();

        loop {
            tokio::select! {
                line = out_lines.next_line() => {
                    match line? {
                        Some(text) => {
                            let clean = strip_ansi(&text);
                            stdout_buf.push_str(&clean);
                            stdout_buf.push('\n');
                            let _ = app.emit(&options.event_id, RetrieveEvent {
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
                        let _ = app.emit(&options.event_id, RetrieveEvent {
                            event_type: "stderr".to_string(),
                            data: clean,
                        });
                    }
                }
            }
        }

        let status = child.wait().await?;
        let duration_ms = started_at.elapsed().as_millis() as u64;
        let exit_code = status.code().unwrap_or(-1);

        {
            let mut guard = active_deploys()
                .lock()
                .map_err(|_| anyhow::anyhow!("deploy 状态锁不可用"))?;
            guard.remove(&options.event_id);
        }

        let _ = app.emit(
            &options.event_id,
            RetrieveEvent {
                event_type: "exit".to_string(),
                data: format!("退出码: {}", exit_code),
            },
        );

        // Parse deploy result from stdout JSON
        let result = parse_deploy_result(&stdout_buf, exit_code, duration_ms);

        // Write deploy history
        let mode_str = match options.mode {
            DeployMode::Deploy => "deploy",
            DeployMode::ValidateAndDeploy => "deploy",
            DeployMode::ValidateOnly => "validate",
        };
        let errors_json = serde_json::to_string(&result.errors).unwrap_or_default();

        sqlx::query(
            r#"
            INSERT INTO deploy_history
                (org_id, working_dir, mode, test_level, success,
                 deploy_id, component_count, error_count, duration_ms, errors_json)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
            "#,
        )
        .bind(&options.org_id)
        .bind(&options.working_dir)
        .bind(mode_str)
        .bind(test_level_str)
        .bind(result.success)
        .bind(&result.deploy_id)
        .bind(result.component_count as i64)
        .bind(result.error_count as i64)
        .bind(duration_ms as i64)
        .bind(&errors_json)
        .execute(&self.pool)
        .await?;

        // For successful validate/validate+deploy, store deployId for Quick Deploy
        if result.success && !matches!(options.mode, DeployMode::Deploy) {
            if let Some(ref deploy_id) = result.deploy_id {
                let expires_at = Utc::now() + chrono::Duration::days(10);
                sqlx::query(
                    r#"
                    INSERT OR REPLACE INTO deploy_validations
                        (deploy_id, org_id, working_dir, component_count, expires_at)
                    VALUES (?1, ?2, ?3, ?4, ?5)
                    "#,
                )
                .bind(deploy_id)
                .bind(&options.org_id)
                .bind(&options.working_dir)
                .bind(result.component_count as i64)
                .bind(expires_at.to_rfc3339())
                .execute(&self.pool)
                .await?;
            }
        }

        Ok(result)
    }

    pub async fn quick_deploy(
        &self,
        app: AppHandle,
        org_id: &str,
        deploy_id: &str,
        event_id: &str,
    ) -> anyhow::Result<DeployResult> {
        let started_at = Instant::now();

        let sf_path = which::which("sf")
            .or_else(|_| which::which("sfdx"))
            .map_err(|_| anyhow::anyhow!("未找到 sf CLI"))?;

        let mut cmd = Command::new(&sf_path);
        cmd.args([
            "project",
            "deploy",
            "quick",
            "--job-id",
            deploy_id,
            "--target-org",
            org_id,
            "--wait",
            "60",
            "--json",
        ]);

        let current_path = std::env::var("PATH").unwrap_or_default();
        let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
        if !current_path.contains("/opt/homebrew") {
            cmd.env("PATH", format!("{}:{}", extra, current_path));
        }

        cmd.stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd.spawn()?;

        let _ = app.emit(
            event_id,
            RetrieveEvent {
                event_type: "start".to_string(),
                data: format!("开始 Quick Deploy，deployId: {}", deploy_id),
            },
        );

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("无法读取 stderr"))?;
        let mut out_lines = BufReader::new(stdout).lines();
        let mut err_lines = BufReader::new(stderr).lines();
        let mut stdout_buf = String::new();

        loop {
            tokio::select! {
                line = out_lines.next_line() => {
                    match line? {
                        Some(text) => {
                            let clean = strip_ansi(&text);
                            stdout_buf.push_str(&clean);
                            stdout_buf.push('\n');
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
        let exit_code = status.code().unwrap_or(-1);

        let _ = app.emit(
            event_id,
            RetrieveEvent {
                event_type: "exit".to_string(),
                data: format!("退出码: {}", exit_code),
            },
        );

        let mut result = parse_deploy_result(&stdout_buf, exit_code, duration_ms);
        result.deploy_id = Some(deploy_id.to_string());

        // Mark validation as used
        sqlx::query("UPDATE deploy_validations SET used = 1 WHERE deploy_id = ?")
            .bind(deploy_id)
            .execute(&self.pool)
            .await?;

        // Write to history
        let errors_json = serde_json::to_string(&result.errors).unwrap_or_default();
        sqlx::query(
            r#"
            INSERT INTO deploy_history
                (org_id, working_dir, mode, test_level, success,
                 deploy_id, component_count, error_count, duration_ms, errors_json)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
            "#,
        )
        .bind(org_id)
        .bind("")
        .bind("quick_deploy")
        .bind("NoTestRun")
        .bind(result.success)
        .bind(deploy_id)
        .bind(result.component_count as i64)
        .bind(result.error_count as i64)
        .bind(duration_ms as i64)
        .bind(&errors_json)
        .execute(&self.pool)
        .await?;

        Ok(result)
    }

    pub async fn cancel(event_id: &str) -> anyhow::Result<()> {
        let pid = {
            let mut guard = active_deploys()
                .lock()
                .map_err(|_| anyhow::anyhow!("deploy 状态锁不可用"))?;
            guard.remove(event_id)
        };
        if let Some(pid) = pid {
            kill_process(pid).await?;
        }
        Ok(())
    }

    pub async fn list_history(
        pool: &SqlitePool,
        org_id: &str,
        limit: u32,
    ) -> anyhow::Result<Vec<DeployHistoryRecord>> {
        let records = sqlx::query_as::<_, DeployHistoryRecord>(
            r#"
            SELECT id, org_id, working_dir, mode, test_level,
                   success as "success: bool",
                   deploy_id, component_count, error_count, duration_ms,
                   errors_json, executed_at
            FROM deploy_history
            WHERE org_id = ?
            ORDER BY executed_at DESC
            LIMIT ?
            "#,
        )
        .bind(org_id)
        .bind(limit as i64)
        .fetch_all(pool)
        .await?;
        Ok(records)
    }

    pub async fn list_validations(
        pool: &SqlitePool,
        org_id: &str,
    ) -> anyhow::Result<Vec<QuickDeployRecord>> {
        let records = sqlx::query_as::<_, QuickDeployRecord>(
            r#"
            SELECT deploy_id, org_id, working_dir, component_count,
                   expires_at, used as "used: bool", created_at
            FROM deploy_validations
            WHERE org_id = ?
              AND used = 0
              AND datetime(expires_at) > datetime('now')
            ORDER BY created_at DESC
            "#,
        )
        .bind(org_id)
        .fetch_all(pool)
        .await?;
        Ok(records)
    }
}

fn parse_deploy_result(stdout_buf: &str, exit_code: i32, duration_ms: u64) -> DeployResult {
    // Try to parse the JSON output from sf CLI
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout_buf) {
        let result_obj = json.get("result");

        let deploy_id = result_obj
            .and_then(|r| r.get("id"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let success = result_obj
            .and_then(|r| r.get("success"))
            .and_then(|v| v.as_bool())
            .unwrap_or(exit_code == 0);

        let component_count = result_obj
            .and_then(|r| r.get("numberComponentsDeployed"))
            .or_else(|| result_obj.and_then(|r| r.get("numberComponentsTotal")))
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as usize;

        let errors = parse_deploy_errors(result_obj);
        let error_count = errors.len();

        DeployResult {
            success,
            deploy_id,
            error_count,
            component_count,
            duration_ms,
            errors,
        }
    } else {
        DeployResult {
            success: exit_code == 0,
            deploy_id: None,
            error_count: 0,
            component_count: 0,
            duration_ms,
            errors: vec![],
        }
    }
}

fn parse_deploy_errors(
    result_obj: Option<&serde_json::Value>,
) -> Vec<DeployError> {
    let Some(result) = result_obj else { return vec![] };

    // Try details.componentFailures first
    let failures = result
        .get("details")
        .and_then(|d| d.get("componentFailures"))
        .and_then(|v| v.as_array());

    if let Some(arr) = failures {
        return arr
            .iter()
            .filter_map(|f| {
                Some(DeployError {
                    file_name: f.get("fileName").and_then(|v| v.as_str())?.to_string(),
                    line_number: f.get("lineNumber").and_then(|v| v.as_u64()).map(|n| n as u32),
                    column_number: f.get("columnNumber").and_then(|v| v.as_u64()).map(|n| n as u32),
                    message: f.get("problem").and_then(|v| v.as_str())?.to_string(),
                    error_type: f
                        .get("problemType")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Error")
                        .to_string(),
                })
            })
            .collect();
    }

    vec![]
}

async fn kill_process(pid: u32) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消 deploy 失败");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消 deploy 失败");
        }
    }
    Ok(())
}
