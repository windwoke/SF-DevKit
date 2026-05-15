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

        // Ensure a minimal sfdx-project.json exists — sf CLI requires a valid project workspace
        let project_json_path = format!("{}/sfdx-project.json", options.working_dir);
        let project_json_existed = std::path::Path::new(&project_json_path).exists();
        if !project_json_existed {
            std::fs::write(
                &project_json_path,
                r#"{"packageDirectories":[{"path":".","default":true}],"namespace":"","sfdcLoginUrl":"https://login.salesforce.com","sourceApiVersion":"63.0"}"#,
            )?;
        }

        // Build CLI args — no --json so the CLI streams progress text to stdout
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

        if matches!(options.test_level, TestLevel::RunSpecifiedTests)
            && !options.test_classes.is_empty()
        {
            for cls in &options.test_classes {
                args.extend(["--tests".into(), cls.clone()]);
            }
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
        // Force Node.js to flush stdout more frequently
        cmd.env("FORCE_COLOR", "0");

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
        let mut emit_buf = Vec::new();
        let mut last_flush = tokio::time::Instant::now();
        const FLUSH_INTERVAL_MS: u64 = 200;

        let flush_buf = |buf: &mut Vec<String>, app: &AppHandle, event_id: &str| {
            if !buf.is_empty() {
                let _ = app.emit(event_id, RetrieveEvent {
                    event_type: "stdout".to_string(),
                    data: buf.join("\n"),
                });
                buf.clear();
            }
        };

        loop {
            tokio::select! {
                line = out_lines.next_line() => {
                    match line? {
                        Some(text) => {
                            let clean = strip_ansi(&text);
                            stdout_buf.push_str(&clean);
                            stdout_buf.push('\n');
                            emit_buf.push(clean);
                            if last_flush.elapsed().as_millis() as u64 >= FLUSH_INTERVAL_MS {
                                flush_buf(&mut emit_buf, &app, &options.event_id);
                                last_flush = tokio::time::Instant::now();
                            }
                        }
                        None => {
                            flush_buf(&mut emit_buf, &app, &options.event_id);
                            break;
                        }
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

        // Parse deploy result — try to extract deploy ID from text output,
        // then fetch structured JSON via `sf project deploy report --json`
        let deploy_id_from_text = extract_deploy_id(&stdout_buf);
        let result = if let Some(ref did) = deploy_id_from_text {
            match fetch_deploy_report(&sf_path, did, &options.org_id, &options.working_dir).await {
                Ok(r) => DeployResult {
                    duration_ms,
                    ..r
                },
                Err(e) => {
                    eprintln!("[deploy] report fetch failed: {}, falling back to text parse", e);
                    parse_deploy_result(&stdout_buf, exit_code, duration_ms, &options.working_dir)
                }
            }
        } else {
            parse_deploy_result(&stdout_buf, exit_code, duration_ms, &options.working_dir)
        };

        // Write deploy history
        let mode_str = match options.mode {
            DeployMode::Deploy => "deploy",
            DeployMode::ValidateAndDeploy => "deploy",
            DeployMode::ValidateOnly => "validate",
        };
        let errors_json = serde_json::to_string(&result.errors).unwrap_or_default();

        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO deploy_history
                (org_id, working_dir, mode, test_level, success,
                 deploy_id, component_count, error_count, duration_ms, errors_json, executed_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
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
        .bind(&now)
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

        let mut result = parse_deploy_result(&stdout_buf, exit_code, duration_ms, "");
        result.deploy_id = Some(deploy_id.to_string());

        // Mark validation as used
        sqlx::query("UPDATE deploy_validations SET used = 1 WHERE deploy_id = ?")
            .bind(deploy_id)
            .execute(&self.pool)
            .await?;

        // Write to history
        let errors_json = serde_json::to_string(&result.errors).unwrap_or_default();
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO deploy_history
                (org_id, working_dir, mode, test_level, success,
                 deploy_id, component_count, error_count, duration_ms, errors_json, executed_at)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
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
        .bind(&now)
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
                   success,
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
                   expires_at, used, created_at
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

fn parse_deploy_result(stdout_buf: &str, exit_code: i32, duration_ms: u64, working_dir: &str) -> DeployResult {
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

        let errors = parse_deploy_errors(result_obj, working_dir);
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

/// Extract a Salesforce async deploy ID (e.g. 0AfXXXXXXXXXXXXXXX) from text output.
fn extract_deploy_id(text: &str) -> Option<String> {
    let re = regex::Regex::new(r"0Af[A-Za-z0-9]{15}").ok()?;
    re.find(text).map(|m| m.as_str().to_string())
}

/// Run `sf project deploy report --json` to fetch structured results after a deploy.
/// Times out after 30s to avoid blocking the UI indefinitely.
async fn fetch_deploy_report(
    sf_path: &std::path::Path,
    deploy_id: &str,
    org_id: &str,
    working_dir: &str,
) -> anyhow::Result<DeployResult> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        Command::new(sf_path)
            .args([
                "project", "deploy", "report",
                "--job-id", deploy_id,
                "--target-org", org_id,
                "--json",
            ])
            .current_dir(working_dir)
            .output(),
    )
    .await
    .map_err(|_| anyhow::anyhow!("deploy report timed out after 30s"))??;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_deploy_result(&stdout, output.status.code().unwrap_or(-1), 0, working_dir))
}

fn parse_deploy_errors(
    result_obj: Option<&serde_json::Value>,
    working_dir: &str,
) -> Vec<DeployError> {
    let Some(result) = result_obj else { return vec![] };
    let mut errors = Vec::new();

    // 1. Component failures
    if let Some(arr) = result
        .get("details")
        .and_then(|d| d.get("componentFailures"))
        .and_then(|v| v.as_array())
    {
        for f in arr {
            let raw_file = f
                .get("fileName")
                .or_else(|| f.get("filePath"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");
            let file_name = raw_file
                .strip_prefix(working_dir)
                .and_then(|s| s.strip_prefix('/'))
                .unwrap_or(raw_file)
                .to_string();

            let message = f
                .get("problem")
                .or_else(|| f.get("error"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string();

            errors.push(DeployError {
                file_name,
                full_name: f
                    .get("fullName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                component_type: f
                    .get("componentType")
                    .or_else(|| f.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
                    .to_string(),
                line_number: f.get("lineNumber").and_then(|v| v.as_u64()).map(|n| n as u32),
                column_number: f.get("columnNumber").and_then(|v| v.as_u64()).map(|n| n as u32),
                message,
                error_type: f
                    .get("problemType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Error")
                    .to_string(),
            });
        }
    }

    // 2. Test failures (runTestResult.failures)
    if let Some(arr) = result
        .get("details")
        .and_then(|d| d.get("runTestResult"))
        .and_then(|r| r.get("failures"))
        .and_then(|v| v.as_array())
    {
        for f in arr {
            let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("unknown");
            let method = f
                .get("methodName")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let message = f
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown test failure");
            let stack = f
                .get("stackTrace")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let (line, col) = parse_line_col_from_stack(stack);

            errors.push(DeployError {
                file_name: format!("{}.cls", name),
                full_name: name.to_string(),
                component_type: "ApexClass".to_string(),
                line_number: line,
                column_number: col,
                message: if method.is_empty() {
                    message.to_string()
                } else {
                    format!("{}.{}: {}", name, method, message)
                },
                error_type: "TestFailure".to_string(),
            });
        }
    }

    errors
}

/// Extract line and column from a stack trace like "Class.Foo.test: line 5, column 1"
fn parse_line_col_from_stack(stack: &str) -> (Option<u32>, Option<u32>) {
    let re = match regex::Regex::new(r"line (\d+), column (\d+)") {
        Ok(r) => r,
        Err(_) => return (None, None),
    };
    match re.captures(stack) {
        Some(caps) => (
            caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok()),
            caps.get(2).and_then(|m| m.as_str().parse::<u32>().ok()),
        ),
        None => (None, None),
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
