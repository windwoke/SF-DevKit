use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::cli::runner::run_command;
use crate::db::models::OrgAuth;

static ACTIVE_LOGIN: OnceLock<Mutex<Option<u32>>> = OnceLock::new();

fn active_login() -> &'static Mutex<Option<u32>> {
    ACTIVE_LOGIN.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SfOrg {
    pub username: String,
    pub alias: Option<String>,
    pub instance_url: String,
    pub expiration_date: Option<String>,
    pub is_default_username: Option<bool>,
}

pub async fn sync_orgs(pool: &SqlitePool) -> anyhow::Result<Vec<OrgAuth>> {
    let output = run_command(&["org", "list", "--all"], true).await?;
    let json: serde_json::Value = serde_json::from_str(&output.stdout)?;
    let mut all_orgs: Vec<SfOrg> = vec![];

    if let Some(arr) = json["result"]["nonScratchOrgs"].as_array() {
        for org in arr {
            if let Ok(parsed) = serde_json::from_value::<SfOrg>(org.clone()) {
                all_orgs.push(parsed);
            }
        }
    }
    if let Some(arr) = json["result"]["scratchOrgs"].as_array() {
        for org in arr {
            if let Ok(parsed) = serde_json::from_value::<SfOrg>(org.clone()) {
                all_orgs.push(parsed);
            }
        }
    }

    let default_username = all_orgs
        .iter()
        .find_map(|org| org.is_default_username.filter(|flag| *flag).map(|_| org.username.clone()));

    let mut tx = pool.begin().await?;
    for org in all_orgs {
        let org_type = if org.expiration_date.is_some() {
            "scratch"
        } else if org.instance_url.contains("sandbox") {
            "sandbox"
        } else {
            "production"
        };
        let is_default = default_username
            .as_ref()
            .is_some_and(|username| username == &org.username);

        sqlx::query(
            r#"
            INSERT INTO org_auth (id, alias, instance_url, org_type, is_default, expires_at, last_used)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              alias = excluded.alias,
              instance_url = excluded.instance_url,
              org_type = excluded.org_type,
              is_default = excluded.is_default,
              expires_at = excluded.expires_at,
              last_used = datetime('now')
            "#,
        )
        .bind(&org.username)
        .bind(&org.alias)
        .bind(&org.instance_url)
        .bind(org_type)
        .bind(if is_default { 1_i64 } else { 0_i64 })
        .bind(&org.expiration_date)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    if default_username.is_none() {
        sync_default_org_from_cli(pool).await?;
    }
    list_orgs(pool).await
}

pub async fn list_orgs(pool: &SqlitePool) -> anyhow::Result<Vec<OrgAuth>> {
    let rows = sqlx::query_as::<_, OrgAuth>(
        r#"
        SELECT id, alias, instance_url, org_type, is_default, expires_at, last_used, linked_project_path
        FROM org_auth
        ORDER BY is_default DESC, datetime(last_used) DESC
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn set_default_org(pool: &SqlitePool, username: &str) -> anyhow::Result<()> {
    run_command(&["config", "set", "target-org", username], false).await?;
    apply_default_org(pool, username).await?;
    Ok(())
}

pub async fn logout_org(pool: &SqlitePool, username: &str) -> anyhow::Result<()> {
    run_command(&["org", "logout", "--target-org", username, "--no-prompt"], false).await?;
    sqlx::query("DELETE FROM org_auth WHERE id = ?1")
        .bind(username)
        .execute(pool)
        .await?;
    Ok(())
}

/// Web OAuth only. Caller should run `sync_orgs` afterward to refresh the local list.
pub async fn login_org_web(
    alias: Option<String>,
    login_domain: &str,
    instance_url: Option<&str>,
    consumer_key: Option<&str>,
    consumer_secret: Option<&str>,
    port: Option<u16>,
) -> anyhow::Result<()> {
    let resolved_url = match login_domain {
        "alibaba" => instance_url
            .map(str::trim)
            .filter(|u| !u.is_empty())
            .ok_or_else(|| anyhow::anyhow!("阿里云版 Salesforce 必须提供 Instance URL"))?,
        _ => login_instance_url(login_domain),
    };

    let mut args: Vec<String> = vec![
        "org".to_string(),
        "login".to_string(),
        "web".to_string(),
        "--set-default".to_string(),
        "--instance-url".to_string(),
        resolved_url.to_string(),
    ];

    // Alibaba Cloud requires the connected app consumer key (-i)
    if let Some(key) = consumer_key.map(str::trim).filter(|k| !k.is_empty()) {
        args.push("-i".to_string());
        args.push(key.to_string());
    }

    // Consumer secret is piped via stdin (not a CLI flag in sf CLI < 2.130)

    if let Some(trimmed_alias) = alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--alias".to_string());
        args.push(trimmed_alias.to_string());
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    eprintln!("[login] sf {}", arg_refs.join(" "));

    // Alibaba Cloud needs special env vars to bypass DNS/domain checks
    let is_alibaba = login_domain == "alibaba";

    // For Alibaba Cloud with consumer secret: use `expect` to create a PTY.
    // Flow: CLI prompts for secret FIRST → then opens browser → callback arrives.
    // `expect` auto-sends the secret so the CLI can proceed to start the HTTP server.
    let use_expect = is_alibaba
        && consumer_secret
            .map(str::trim)
            .is_some_and(|s| !s.is_empty());

    let result = if use_expect {
        let secret = consumer_secret
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("");
        run_login_with_expect(&arg_refs, is_alibaba, secret, port).await
    } else {
        run_login_command(&arg_refs, is_alibaba).await
    };
    {
        let mut guard = active_login().lock().map_err(|_| anyhow::anyhow!("login 状态锁不可用"))?;
        *guard = None;
    }
    result
}

/// Cancel an in-progress login by killing the sf CLI process.
pub async fn cancel_login() -> anyhow::Result<()> {
    let pid = {
        let mut guard = active_login().lock().map_err(|_| anyhow::anyhow!("login 状态锁不可用"))?;
        guard.take()
    };
    if let Some(pid) = pid {
        kill_process(pid).await?;
    }
    Ok(())
}

pub async fn open_org(username: &str) -> anyhow::Result<()> {
    run_command(&["org", "open", "--target-org", username], false).await?;
    Ok(())
}

pub fn pick_project_directory() -> anyhow::Result<Option<String>> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned()))
}

pub async fn set_org_linked_project_path(
    pool: &SqlitePool,
    org_id: &str,
    path: Option<String>,
) -> anyhow::Result<()> {
    let normalized = path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    let res = sqlx::query(
        r#"
        UPDATE org_auth
        SET linked_project_path = ?1
        WHERE id = ?2
        "#,
    )
    .bind(normalized)
    .bind(org_id)
    .execute(pool)
    .await?;
    if res.rows_affected() == 0 {
        anyhow::bail!("未找到 Org：{}", org_id);
    }
    Ok(())
}

pub async fn open_org_linked_project_in_ide(pool: &SqlitePool, org_id: &str) -> anyhow::Result<()> {
    let row = sqlx::query_scalar::<_, Option<String>>(
        "SELECT linked_project_path FROM org_auth WHERE id = ?1",
    )
    .bind(org_id)
    .fetch_optional(pool)
    .await?;
    let Some(linked) = row else {
        anyhow::bail!("未找到 Org：{}", org_id);
    };
    let Some(path) = linked.filter(|p| !p.trim().is_empty()) else {
        anyhow::bail!("该 Org 尚未关联本地项目路径");
    };
    open_path_in_ide(path.trim()).await
}

async fn open_path_in_ide(path: &str) -> anyhow::Result<()> {
    use std::path::Path;

    let p = Path::new(path);
    if !p.exists() {
        anyhow::bail!("路径不存在：{}", path);
    }

    // Inject PATH for bundled macOS apps so child processes can find tools
    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra_path = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    let path_env = if !current_path.contains("/opt/homebrew") {
        format!("{}:{}", extra_path, current_path)
    } else {
        current_path
    };

    #[cfg(target_os = "macos")]
    let editor_bins: &[&str] = &["cursor", "code"];
    #[cfg(target_os = "windows")]
    let editor_bins: &[&str] = &["cursor", "code", "code.cmd"];
    #[cfg(target_os = "linux")]
    let editor_bins: &[&str] = &["cursor", "code", "codium", "code-oss"];
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let editor_bins: &[&str] = &[];

    for bin in editor_bins {
        let bin_path = crate::cli::runner::find_editor(bin);
        if let Some(editor_path) = bin_path {
            if tokio::process::Command::new(&editor_path)
                .arg(path)
                .env("PATH", &path_env)
                .status()
                .await
                .is_ok_and(|s| s.success())
            {
                return Ok(());
            }
        }
    }

    // Fallback to system file opener
    #[cfg(target_os = "macos")]
    {
        let status = tokio::process::Command::new("open").arg(path).status().await?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("无法在 Finder 中打开该路径");
    }
    #[cfg(target_os = "windows")]
    {
        let status = tokio::process::Command::new("explorer").arg(path).status().await?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("无法打开该路径");
    }
    #[cfg(target_os = "linux")]
    {
        let status = tokio::process::Command::new("xdg-open").arg(path).status().await?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("xdg-open 失败");
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        anyhow::bail!("当前平台不支持从应用内打开 IDE");
    }
}

fn login_instance_url(login_domain: &str) -> &'static str {
    match login_domain {
        "sandbox" => "https://test.salesforce.com",
        _ => "https://login.salesforce.com",
    }
}

/// Like `run_command` but tracks the child PID for cancellation.
/// When `alibaba_env` is true, sets SF_DISABLE_DNS_CHECK and SF_DOMAIN_RETRY env vars.
async fn run_login_command(
    args: &[&str],
    alibaba_env: bool,
) -> anyhow::Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    // Kill stale processes on OAuth redirect port
    let _ = Command::new("bash")
        .arg("-c")
        .arg("lsof -ti:1717 | xargs kill -9 2>/dev/null || true")
        .status()
        .await;

    let sf_path = crate::cli::runner::find_sf()
        .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

    let mut cmd = Command::new(&sf_path);
    cmd.args(args);

    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    if alibaba_env {
        cmd.env("SF_DISABLE_DNS_CHECK", "true");
        cmd.env("SF_DOMAIN_RETRY", "0");
    }

    cmd.stdin(Stdio::inherit())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn()?;

    if let Some(pid) = child.id() {
        eprintln!("[login] spawned pid={}", pid);
        if let Ok(mut guard) = active_login().lock() {
            *guard = Some(pid);
        }
    }

    // Collect stdout and stderr in a spawned task
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let collect_handle = tokio::spawn(async move {
        let mut stdout_lines = stdout.map(|r| BufReader::new(r).lines());
        let mut stderr_lines = stderr.map(|r| BufReader::new(r).lines());
        let mut combined_output = String::new();

        loop {
            tokio::select! {
                line = async { match &mut stdout_lines {
                    Some(lines) => lines.next_line().await,
                    None => Ok(None),
                }} => {
                    match line {
                        Ok(Some(l)) => {
                            eprintln!("[login:out] {}", l);
                            combined_output.push_str(&l);
                            combined_output.push('\n');
                        }
                        _ => break,
                    }
                }
                line = async { match &mut stderr_lines {
                    Some(lines) => lines.next_line().await,
                    None => Ok(None),
                }} => {
                    match line {
                        Ok(Some(l)) => {
                            eprintln!("[login:err] {}", l);
                            combined_output.push_str(&l);
                            combined_output.push('\n');
                        }
                        _ => break,
                    }
                }
            }
        }

        combined_output
    });

    // Wait for process with a 3-minute timeout
    let status = tokio::time::timeout(
        std::time::Duration::from_secs(180),
        child.wait(),
    )
    .await;

    match status {
        Ok(Ok(s)) => {
            let combined_output = collect_handle.await.unwrap_or_default();
            eprintln!("[login] exit code={}", s.code().unwrap_or(-1));
            if !s.success() {
                let error_msg = extract_cli_error(&combined_output);
                anyhow::bail!("登录失败：{}", error_msg);
            }
            if !verify_login_success(&combined_output) {
                anyhow::bail!("LOGIN_NOT_COMPLETED");
            }
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = collect_handle.await;
            anyhow::bail!("登录进程异常：{}", e);
        }
        Err(_) => {
            // Timeout — kill the process
            eprintln!("[login] timed out after 180s, killing");
            let _ = kill_process(
                active_login().lock().ok().and_then(|mut g| g.take()).unwrap_or(0),
            )
            .await;
            let combined_output = collect_handle.await.unwrap_or_default();
            let error_msg = extract_cli_error(&combined_output);
            anyhow::bail!("登录超时（180s），CLI 输出：{}", error_msg);
        }
    }
}

/// Run login via `/usr/bin/expect` to create a real PTY.
/// The CLI prompts for consumer secret BEFORE opening the browser.
/// `expect` auto-sends the secret, then the CLI starts the HTTP server and opens browser.
async fn run_login_with_expect(
    sf_args: &[&str],
    alibaba_env: bool,
    secret: &str,
    port: Option<u16>,
) -> anyhow::Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let sf_path = crate::cli::runner::find_sf()
        .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

    // Create a temp directory with sfdx-project.json containing oauthLocalPort
    let temp_dir = std::env::temp_dir().join("sf-devkit-login");
    std::fs::create_dir_all(&temp_dir)?;
    let oauth_port = port.unwrap_or(1717);
    let project_json = format!(
        r#"{{"packageDirectories":[{{"path":"force-app","default":true}}],"name":"sf-devkit-login","oauthLocalPort":"{}"}}"#,
        oauth_port
    );
    std::fs::write(temp_dir.join("sfdx-project.json"), &project_json)?;
    eprintln!("[login:expect] temp sfdx-project.json at {:?}, port={}", temp_dir, oauth_port);

    // Kill stale process on the target port
    let _ = Command::new("bash")
        .arg("-c")
        .arg(format!("lsof -ti:{} | xargs kill -9 2>/dev/null || true", oauth_port))
        .status()
        .await;

    // Build the expect script:
    //   1. spawn sf CLI (it will prompt for consumer secret first)
    //   2. wait for the "OAuth client secret" prompt
    //   3. send the secret
    //   4. wait for process to finish
    let escaped_secret = secret.replace('\\', "\\\\").replace('"', "\\\"");
    let expect_script = format!(
        "set timeout 300\nspawn {} {}\nexpect -re \"OAuth client secret\" {{ sleep 1; send \"{}\\r\" }}\nexpect eof\n",
        sf_path.display(),
        sf_args.join(" "),
        escaped_secret,
    );

    eprintln!("[login:expect] sf {}", sf_args.join(" "));

    let mut cmd = Command::new("/usr/bin/expect");
    cmd.current_dir(&temp_dir)
        .arg("-c")
        .arg(&expect_script)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    if alibaba_env {
        cmd.env("SF_DISABLE_DNS_CHECK", "true");
        cmd.env("SF_DOMAIN_RETRY", "0");
    }

    let mut child = cmd.spawn()?;

    if let Some(pid) = child.id() {
        eprintln!("[login:expect] pid={}", pid);
        if let Ok(mut guard) = active_login().lock() {
            *guard = Some(pid);
        }
    }

    // Collect output
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let collect_handle = tokio::spawn(async move {
        let mut stdout_lines = stdout.map(|r| BufReader::new(r).lines());
        let mut stderr_lines = stderr.map(|r| BufReader::new(r).lines());
        let mut combined_output = String::new();

        loop {
            tokio::select! {
                line = async { match &mut stdout_lines {
                    Some(lines) => lines.next_line().await,
                    None => Ok(None),
                }} => match line {
                    Ok(Some(l)) => {
                        eprintln!("[login:expect:out] {}", l);
                        combined_output.push_str(&l);
                        combined_output.push('\n');
                    }
                    _ => break,
                },
                line = async { match &mut stderr_lines {
                    Some(lines) => lines.next_line().await,
                    None => Ok(None),
                }} => match line {
                    Ok(Some(l)) => {
                        eprintln!("[login:expect:err] {}", l);
                        combined_output.push_str(&l);
                        combined_output.push('\n');
                    }
                    _ => break,
                },
            }
        }
        combined_output
    });

    let status = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        child.wait(),
    )
    .await;

    match status {
        Ok(Ok(s)) => {
            let combined_output = collect_handle.await.unwrap_or_default();
            eprintln!("[login:expect] exit={}", s.code().unwrap_or(-1));
            if !s.success() {
                let error_msg = extract_cli_error(&combined_output);
                anyhow::bail!("登录失败：{}", error_msg);
            }
            if !verify_login_success(&combined_output) {
                anyhow::bail!("LOGIN_NOT_COMPLETED");
            }
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = collect_handle.await;
            anyhow::bail!("登录进程异常：{}", e);
        }
        Err(_) => {
            eprintln!("[login:expect] timeout 300s");
            let _ = kill_process(
                active_login().lock().ok().and_then(|mut g| g.take()).unwrap_or(0),
            )
            .await;
            let combined_output = collect_handle.await.unwrap_or_default();
            anyhow::bail!("登录超时，CLI 输出：{}", extract_cli_error(&combined_output));
        }
    }
}

/// Verify that the sf CLI output indicates a real successful login.
/// The CLI may exit with code 0 even when the browser OAuth was never completed.
fn verify_login_success(output: &str) -> bool {
    let lower = output.to_lowercase();
    // sf CLI "org login web" success messages across versions:
    //   "Successfully authorized <username> with org ID <id>"
    //   "Successfully logged in as <username>"
    lower.contains("successfully authorized")
        || lower.contains("successfully logged in")
        || lower.contains("successfully authenticated")
        || lower.contains("with org id")
}

/// Extract a human-readable error message from sf CLI output.
fn extract_cli_error(output: &str) -> String {
    // Try to parse JSON error from sf CLI
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(output) {
        if let Some(msg) = json["message"].as_str() {
            return msg.to_string();
        }
        if let Some(arr) = json["result"].as_array() {
            if let Some(first) = arr.first() {
                if let Some(msg) = first["message"].as_str() {
                    return msg.to_string();
                }
            }
        }
    }
    // Fallback: return last few non-empty lines
    let lines: Vec<&str> = output.lines().filter(|l| !l.trim().is_empty()).collect();
    let tail: Vec<&str> = lines.iter().rev().take(3).cloned().collect();
    let mut tail: Vec<&str> = tail.into_iter().rev().collect();
    if tail.is_empty() {
        return "未知错误".to_string();
    }
    tail.join("\n")
}

async fn kill_process(pid: u32) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        let status = tokio::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消登录失败");
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let status = tokio::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("取消登录失败");
        }
    }
    Ok(())
}

async fn sync_default_org_from_cli(pool: &SqlitePool) -> anyhow::Result<()> {
    let output = run_command(&["config", "get", "target-org"], true).await?;
    let parsed: serde_json::Value = serde_json::from_str(&output.stdout)?;
    let Some(default_org) = parse_default_org(&parsed) else {
        return Ok(());
    };

    apply_default_org(pool, &default_org).await?;
    Ok(())
}

fn parse_default_org(json: &serde_json::Value) -> Option<String> {
    json.get("result")
        .and_then(|result| result.as_array())
        .and_then(|items| {
            items.iter().find_map(|item| {
                let matches_key = item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .is_some_and(|name| name == "target-org");
                if matches_key {
                    item.get("value")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
}

async fn apply_default_org(pool: &SqlitePool, default_org_ref: &str) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        UPDATE org_auth
        SET is_default = CASE WHEN id = ?1 OR alias = ?1 THEN 1 ELSE 0 END
        "#,
    )
    .bind(default_org_ref)
    .execute(pool)
    .await?;
    Ok(())
}
