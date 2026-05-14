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
pub async fn login_org_web(alias: Option<String>, login_domain: &str) -> anyhow::Result<()> {
    let mut args: Vec<String> = vec![
        "org".to_string(),
        "login".to_string(),
        "web".to_string(),
        "--set-default".to_string(),
        "--instance-url".to_string(),
        login_instance_url(login_domain).to_string(),
    ];

    if let Some(trimmed_alias) = alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--alias".to_string());
        args.push(trimmed_alias.to_string());
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();

    // Run with PID tracking so login can be cancelled
    let result = run_login_command(&arg_refs).await;
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
    use tokio::process::Command;

    let p = Path::new(path);
    if !p.exists() {
        anyhow::bail!("路径不存在：{}", path);
    }

    #[cfg(target_os = "macos")]
    {
        for bin in ["cursor", "code"] {
            if which::which(bin).is_ok() {
                if Command::new(bin)
                    .arg(path)
                    .status()
                    .await
                    .is_ok_and(|s| s.success())
                {
                    return Ok(());
                }
            }
        }
        let status = Command::new("open").arg(path).status().await?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("无法在 Finder 中打开该路径");
    }

    #[cfg(target_os = "windows")]
    {
        for bin in ["cursor", "code", "code.cmd"] {
            if which::which(bin).is_ok() {
                if Command::new(bin)
                    .arg(path)
                    .status()
                    .await
                    .is_ok_and(|s| s.success())
                {
                    return Ok(());
                }
            }
        }
        let status = Command::new("explorer").arg(path).status().await?;
        if status.success() {
            return Ok(());
        }
        anyhow::bail!("无法打开该路径");
    }

    #[cfg(target_os = "linux")]
    {
        for bin in ["cursor", "code", "codium", "code-oss"] {
            if which::which(bin).is_ok() {
                if Command::new(bin)
                    .arg(path)
                    .status()
                    .await
                    .is_ok_and(|s| s.success())
                {
                    return Ok(());
                }
            }
        }
        let status = Command::new("xdg-open").arg(path).status().await?;
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
async fn run_login_command(args: &[&str]) -> anyhow::Result<()> {
    use std::process::Stdio;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let sf_path = crate::cli::runner::find_sf()
        .ok_or_else(|| anyhow::anyhow!("未找到 sf CLI，请先安装 Salesforce CLI"))?;

    let mut cmd = Command::new(&sf_path);
    cmd.args(args);

    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn()?;

    if let Some(pid) = child.id() {
        if let Ok(mut guard) = active_login().lock() {
            *guard = Some(pid);
        }
    }

    // Drain stdout/stderr so the pipe doesn't block
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Some(out) = stdout {
        let mut lines = BufReader::new(out).lines();
        while let Ok(Some(_)) = lines.next_line().await {}
    }
    if let Some(err) = stderr {
        let mut lines = BufReader::new(err).lines();
        while let Ok(Some(_)) = lines.next_line().await {}
    }

    let status = child.wait().await?;
    if !status.success() {
        anyhow::bail!("登录失败或已取消");
    }
    Ok(())
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
