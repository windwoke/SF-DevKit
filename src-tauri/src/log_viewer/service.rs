use std::path::Path;

use anyhow::Context;
use chrono::{Duration, Utc};
use reqwest::Client;
use serde::Deserialize;
use serde_json::Value;
use sqlx::FromRow;
use sqlx::SqlitePool;
use tokio::process::Command;

use crate::cli::runner::{find_editor, run_command, SuppressConsole};

use super::models::{ActiveTrace, ApexClassItem, ApexLog, SfUser};

pub async fn list_apex_logs(
    org_id: &str,
    limit: u32,
    user_filter: Option<&str>,
) -> anyhow::Result<Vec<ApexLog>> {
    // Newer sf CLI uses: sf apex list log (no --number flag for list)
    let output = run_command(&["apex", "list", "log", "--target-org", org_id], true).await?;
    if !output.success {
        anyhow::bail!("{}", cli_error_message(&output.stderr, &output.stdout));
    }

    let json: Value = serde_json::from_str(&output.stdout).context("解析日志列表 JSON 失败")?;
    let arr = json
        .get("result")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut logs: Vec<ApexLog> = arr.iter().map(parse_apex_log).collect();
    if let Some(filter) = user_filter.filter(|s| !s.trim().is_empty()) {
        let needle = filter.trim().to_lowercase();
        logs.retain(|l| {
            l.log_user_name.to_lowercase().contains(&needle)
                || l.operation.to_lowercase().contains(&needle)
        });
    }
    logs.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    if limit > 0 && logs.len() > limit as usize {
        logs.truncate(limit as usize);
    }
    Ok(logs)
}

pub async fn download_apex_log(
    pool: &SqlitePool,
    org_id: &str,
    log_id: &str,
    output_dir: &str,
    file_name: &str,
) -> anyhow::Result<String> {
    tokio::fs::create_dir_all(output_dir)
        .await
        .with_context(|| format!("创建目录失败：{}", output_dir))?;

    let output = run_command(
        &[
            "apex",
            "log",
            "get",
            "--target-org",
            org_id,
            "--log-id",
            log_id,
        ],
        false,
    )
    .await?;
    if !output.success {
        anyhow::bail!("{}", cli_error_message(&output.stderr, &output.stdout));
    }

    let clean_log_text = strip_terminal_escape_sequences(&output.stdout);
    let file_path = Path::new(output_dir).join(file_name);
    tokio::fs::write(&file_path, clean_log_text.as_bytes())
        .await
        .with_context(|| format!("写入日志文件失败：{}", file_path.display()))?;

    let meta_size = tokio::fs::metadata(&file_path)
        .await
        .ok()
        .map(|m| m.len() as i64);
    let _ = sqlx::query(
        r#"
        INSERT INTO log_downloads (org_id, log_id, file_path, file_size)
        VALUES (?1, ?2, ?3, ?4)
        "#,
    )
    .bind(org_id)
    .bind(log_id)
    .bind(file_path.to_string_lossy().to_string())
    .bind(meta_size)
    .execute(pool)
    .await;

    Ok(file_path.to_string_lossy().to_string())
}

fn strip_terminal_escape_sequences(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == 0x1b {
            i += 1;
            if i < bytes.len() && bytes[i] == b'[' {
                // CSI: ESC [ ... final-byte(@-~)
                i += 1;
                while i < bytes.len() {
                    let b = bytes[i];
                    i += 1;
                    if (0x40..=0x7e).contains(&b) {
                        break;
                    }
                }
                continue;
            }
            if i < bytes.len() && bytes[i] == b']' {
                // OSC: ESC ] ... BEL or ESC \
                i += 1;
                while i < bytes.len() {
                    if bytes[i] == 0x07 {
                        i += 1;
                        break;
                    }
                    if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'\\' {
                        i += 2;
                        break;
                    }
                    i += 1;
                }
                continue;
            }
            continue;
        }

        out.push(bytes[i]);
        i += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

pub async fn download_latest_self_log(
    pool: &SqlitePool,
    org_id: &str,
    current_user_name: &str,
    output_dir: &str,
) -> anyhow::Result<Option<String>> {
    let user_key = current_user_name.trim();
    let logs = list_apex_logs(org_id, 20, Some(user_key)).await?;
    let Some(latest) = logs.first() else {
        return Ok(None);
    };
    let file_name = build_file_name(latest);
    let path = download_apex_log(pool, org_id, &latest.id, output_dir, &file_name).await?;
    Ok(Some(path))
}

pub async fn open_in_vscode(file_path: &str) -> anyhow::Result<()> {
    let code_cmd = find_editor("code").context(
        "未找到 VSCode CLI（code 命令）。请在 VSCode 中执行：Shell Command: Install 'code' command in PATH",
    )?;

    let mut cmd = Command::new(&code_cmd);
    cmd.suppress_console();
    cmd.arg(file_path);

    // Inject PATH for bundled macOS apps so child processes can find related tools
    let current_path = std::env::var("PATH").unwrap_or_default();
    let extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin";
    if !current_path.contains("/opt/homebrew") {
        cmd.env("PATH", format!("{}:{}", extra, current_path));
    }

    let status = cmd.status().await?;
    if !status.success() {
        anyhow::bail!("VSCode 启动失败");
    }
    Ok(())
}

pub async fn reveal_log_file(file_path: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .suppress_console()
            .args(["-R", file_path])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("无法在 Finder 中显示文件");
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("explorer")
            .suppress_console()
            .args(["/select,", file_path])
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("无法在资源管理器中显示文件");
        }
    }

    #[cfg(target_os = "linux")]
    {
        let parent = Path::new(file_path)
            .parent()
            .unwrap_or_else(|| Path::new("/"));
        let status = Command::new("xdg-open")
            .suppress_console()
            .arg(parent)
            .status()
            .await?;
        if !status.success() {
            anyhow::bail!("无法打开文件目录");
        }
    }

    Ok(())
}

pub async fn get_current_user(org_id: &str) -> anyhow::Result<SfUser> {
    let query = format!(
        "SELECT Id, Name, Username FROM User WHERE Username = '{}' LIMIT 1",
        escape_soql(org_id)
    );
    let resp = query_data(org_id, &query, false).await?;
    parse_first_user(&resp).ok_or_else(|| anyhow::anyhow!("未找到当前用户信息"))
}

pub async fn search_users(
    pool: &SqlitePool,
    org_id: &str,
    keyword: &str,
) -> anyhow::Result<Vec<SfUser>> {
    let k = keyword.trim();
    let cached = if k.is_empty() {
        search_users_cache(pool, org_id, None).await?
    } else {
        search_users_cache(pool, org_id, Some(k)).await?
    };
    if cached.len() >= 5 {
        return Ok(cached);
    }

    let query = if k.is_empty() {
        "SELECT Id, Name, Username FROM User WHERE IsActive = true ORDER BY LastModifiedDate DESC LIMIT 10"
            .to_string()
    } else {
        format!(
            "SELECT Id, Name, Username FROM User WHERE (Username LIKE '%{kw}%' OR Name LIKE '%{kw}%') AND IsActive = true ORDER BY LastModifiedDate DESC LIMIT 10",
            kw = escape_soql(k)
        )
    };
    let resp = query_data(org_id, &query, false).await?;
    let users = parse_users(&resp);

    let mut tx = pool.begin().await?;
    for user in &users {
        sqlx::query(
            r#"
            INSERT INTO sf_users_cache (id, org_id, name, username, cached_at)
            VALUES (?1, ?2, ?3, ?4, datetime('now'))
            ON CONFLICT(id, org_id) DO UPDATE SET
              name = excluded.name,
              username = excluded.username,
              cached_at = datetime('now')
            "#,
        )
        .bind(&user.id)
        .bind(org_id)
        .bind(&user.name)
        .bind(&user.username)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    if users.is_empty() {
        Ok(cached)
    } else {
        Ok(users)
    }
}

pub async fn find_apex_class_id(org_id: &str, class_name: &str) -> anyhow::Result<Option<String>> {
    let query = format!(
        "SELECT Id, Name FROM ApexClass WHERE Name = '{}' LIMIT 1",
        escape_soql(class_name.trim())
    );
    let resp = query_data(org_id, &query, true).await?;
    Ok(resp
        .get("records")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| get_string(row, &["Id", "id"])))
}

pub async fn search_apex_classes(
    org_id: &str,
    keyword: &str,
) -> anyhow::Result<Vec<ApexClassItem>> {
    let k = keyword.trim();
    let query = if k.is_empty() {
        "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass ORDER BY LastModifiedDate DESC LIMIT 20"
            .to_string()
    } else {
        format!(
            "SELECT Id, Name, LastModifiedDate, LastModifiedBy.Name FROM ApexClass WHERE Name LIKE '%{kw}%' ORDER BY LastModifiedDate DESC LIMIT 20",
            kw = escape_soql(k)
        )
    };
    let resp = query_data(org_id, &query, true).await?;
    let classes = resp
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|row| {
            Some(ApexClassItem {
                id: get_string(row, &["Id", "id"])?,
                name: get_string(row, &["Name", "name"])?,
                last_modified_date: get_string(row, &["LastModifiedDate", "lastModifiedDate"]),
                last_modified_by_name: get_string(
                    row,
                    &[
                        "LastModifiedBy.Name",
                        "LastModifiedByName",
                        "lastModifiedByName",
                    ],
                ),
            })
        })
        .collect();
    Ok(classes)
}

pub async fn ensure_debug_level(org_id: &str, preset: &str) -> anyhow::Result<String> {
    let dev_name = format!("SFDevKit_{}", preset);
    let query = format!(
        "SELECT Id FROM DebugLevel WHERE DeveloperName = '{}' LIMIT 1",
        escape_soql(&dev_name)
    );
    let query_resp = query_data(org_id, &query, true).await?;
    if let Some(id) = query_resp
        .get("records")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(|row| get_string(row, &["Id", "id"]))
    {
        return Ok(id);
    }

    let body = if preset == "verbose" {
        serde_json::json!({
            "DeveloperName": dev_name,
            "MasterLabel": "SF DevKit verbose",
            "ApexCode": "FINEST",
            "ApexProfiling": "NONE",
            "Callout": "INFO",
            "Database": "FINE",
            "System": "FINE",
            "Validation": "INFO",
            "Visualforce": "NONE",
            "Workflow": "INFO"
        })
    } else {
        serde_json::json!({
            "DeveloperName": dev_name,
            "MasterLabel": "SF DevKit standard",
            "ApexCode": "DEBUG",
            "ApexProfiling": "NONE",
            "Callout": "INFO",
            "Database": "INFO",
            "System": "DEBUG",
            "Validation": "INFO",
            "Visualforce": "NONE",
            "Workflow": "INFO"
        })
    };
    let created = post_tooling_sobject(org_id, "DebugLevel", &body).await?;
    created
        .get("id")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("创建 DebugLevel 失败"))
}

pub async fn enable_trace(
    pool: &SqlitePool,
    org_id: &str,
    entity_id: &str,
    log_type: &str,
    debug_level_id: &str,
    duration_minutes: u32,
    label: &str,
    kind: &str,
) -> anyhow::Result<ActiveTrace> {
    delete_entity_trace_flags(org_id, entity_id).await?;

    let now = Utc::now();
    // StartDate set to 1 minute in the past — Salesforce rounds to the minute boundary and
    // without an explicit StartDate the trace may not activate for 1-2 minutes after creation.
    let start = (now - Duration::minutes(1)).to_rfc3339();
    let expires = (now + Duration::minutes(duration_minutes as i64)).to_rfc3339();
    let body = serde_json::json!({
        "TracedEntityId": entity_id,
        "DebugLevelId": debug_level_id,
        "LogType": log_type,
        "StartDate": start,
        "ExpirationDate": expires,
    });
    let resp = post_tooling_sobject(org_id, "TraceFlag", &body).await?;
    let trace_flag_id = get_string(&resp, &["id", "Id"])
        .ok_or_else(|| anyhow::anyhow!("创建 TraceFlag 失败: {}", resp))?
        .to_string();

    let _ = sqlx::query(
        r#"
        INSERT INTO trace_targets (id, org_id, kind, label, entity_id, trace_flag_id, debug_level_id, expires_at, is_active)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          trace_flag_id = excluded.trace_flag_id,
          debug_level_id = excluded.debug_level_id,
          expires_at = excluded.expires_at,
          is_active = 1
        "#,
    )
    .bind(entity_id)
    .bind(org_id)
    .bind(kind)
    .bind(label)
    .bind(entity_id)
    .bind(&trace_flag_id)
    .bind(debug_level_id)
    .bind(&expires)
    .execute(pool)
    .await;

    Ok(ActiveTrace {
        trace_flag_id,
        entity_id: entity_id.to_string(),
        log_type: log_type.to_string(),
        expires_at: expires,
    })
}

pub async fn renew_trace(
    pool: &SqlitePool,
    org_id: &str,
    trace_flag_id: &str,
    duration_minutes: u32,
) -> anyhow::Result<String> {
    let session = get_org_session(org_id).await?;
    let client = Client::new();
    let new_expires = (Utc::now() + Duration::minutes(duration_minutes as i64)).to_rfc3339();
    let url = format!(
        "{}/services/data/v60.0/tooling/sobjects/TraceFlag/{}",
        session.instance_url, trace_flag_id
    );
    let resp = client
        .patch(url)
        .bearer_auth(&session.access_token)
        .json(&serde_json::json!({ "ExpirationDate": new_expires }))
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("续期 TraceFlag 失败");
    }

    let _ = sqlx::query(
        "UPDATE trace_targets SET expires_at = ?1, is_active = 1 WHERE trace_flag_id = ?2",
    )
    .bind(&new_expires)
    .bind(trace_flag_id)
    .execute(pool)
    .await;

    Ok(new_expires)
}

pub async fn disable_trace(
    pool: &SqlitePool,
    org_id: &str,
    trace_flag_id: &str,
) -> anyhow::Result<()> {
    let session = get_org_session(org_id).await?;
    let client = Client::new();
    let url = format!(
        "{}/services/data/v60.0/tooling/sobjects/TraceFlag/{}",
        session.instance_url, trace_flag_id
    );
    let resp = client
        .delete(url)
        .bearer_auth(&session.access_token)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let ignore_not_found = status.as_u16() == 404
            || body.contains("NOT_FOUND")
            || body.contains("ENTITY_IS_DELETED")
            || body.contains("INVALID_CROSS_REFERENCE_KEY");
        if !ignore_not_found {
            anyhow::bail!("关闭 TraceFlag 失败: {}", body);
        }
    }

    let _ = sqlx::query(
        "UPDATE trace_targets SET is_active = 0, trace_flag_id = NULL, expires_at = NULL WHERE trace_flag_id = ?1",
    )
    .bind(trace_flag_id)
    .execute(pool)
    .await;
    Ok(())
}

pub fn build_file_name(log: &ApexLog) -> String {
    let date = log
        .start_time
        .replace([':', '.'], "-")
        .chars()
        .take(19)
        .collect::<String>();
    let user = log.log_user_name.split('@').next().unwrap_or("unknown");
    let short_id = log.id.chars().take(8).collect::<String>();
    format!("{}_{}_{}.log", user, short_id, date)
}

fn parse_apex_log(value: &Value) -> ApexLog {
    ApexLog {
        id: get_string(value, &["Id", "id"]).unwrap_or_default(),
        application: get_string(value, &["Application", "application"]).unwrap_or_default(),
        duration_millis: get_i64(value, &["DurationMilliseconds", "durationMilliseconds"])
            .unwrap_or(0),
        location: get_string(value, &["Location", "location"]).unwrap_or_default(),
        log_user_name: get_string(value, &["LogUser.Name", "LogUserName", "logUserName"])
            .unwrap_or_else(|| "unknown".to_string()),
        operation: get_string(value, &["Operation", "operation"]).unwrap_or_default(),
        request: get_string(value, &["Request", "request"]).unwrap_or_default(),
        size: get_i64(value, &["LogLength", "Size", "size"]).unwrap_or(0),
        start_time: get_string(value, &["StartTime", "startTime"]).unwrap_or_default(),
        status: get_string(value, &["Status", "status"]).unwrap_or_default(),
    }
}

fn get_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        if k.contains('.') {
            let mut cur = value;
            for seg in k.split('.') {
                cur = cur.get(seg)?;
            }
            cur.as_str().map(str::to_string)
        } else {
            value.get(k).and_then(|v| v.as_str().map(str::to_string))
        }
    })
}

fn get_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    keys.iter()
        .find_map(|k| value.get(k).and_then(|v| v.as_i64()))
}

fn cli_error_message(stderr: &str, stdout: &str) -> String {
    let msg = if !stderr.trim().is_empty() {
        stderr.trim()
    } else {
        stdout.trim()
    };
    if msg.is_empty() {
        "命令执行失败".to_string()
    } else {
        msg.to_string()
    }
}

fn escape_soql(text: &str) -> String {
    text.replace('\\', "\\\\").replace('\'', "\\'")
}

fn parse_users(resp: &Value) -> Vec<SfUser> {
    resp.get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(parse_user_row)
        .collect()
}

fn parse_first_user(resp: &Value) -> Option<SfUser> {
    resp.get("records")
        .and_then(|v| v.as_array())
        .and_then(|rows| rows.first())
        .and_then(parse_user_row)
}

fn parse_user_row(v: &Value) -> Option<SfUser> {
    Some(SfUser {
        id: get_string(v, &["Id", "id"])?,
        name: get_string(v, &["Name", "name"])?,
        username: get_string(v, &["Username", "username"])?,
    })
}

#[derive(Debug, FromRow)]
struct CachedUserRow {
    id: String,
    name: String,
    username: String,
}

async fn search_users_cache(
    pool: &SqlitePool,
    org_id: &str,
    keyword: Option<&str>,
) -> anyhow::Result<Vec<SfUser>> {
    let rows = if let Some(keyword) = keyword.filter(|v| !v.trim().is_empty()) {
        let pattern = format!("%{}%", keyword);
        sqlx::query_as::<_, CachedUserRow>(
            r#"
            SELECT id, name, username
            FROM sf_users_cache
            WHERE org_id = ?1
              AND (username LIKE ?2 OR name LIKE ?2)
            ORDER BY datetime(cached_at) DESC
            LIMIT 10
            "#,
        )
        .bind(org_id)
        .bind(pattern)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as::<_, CachedUserRow>(
            r#"
            SELECT id, name, username
            FROM sf_users_cache
            WHERE org_id = ?1
            ORDER BY datetime(cached_at) DESC
            LIMIT 10
            "#,
        )
        .bind(org_id)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|r| SfUser {
            id: r.id,
            name: r.name,
            username: r.username,
        })
        .collect())
}

async fn delete_entity_trace_flags(org_id: &str, entity_id: &str) -> anyhow::Result<()> {
    let query = format!(
        "SELECT Id FROM TraceFlag WHERE TracedEntityId = '{}' LIMIT 200",
        escape_soql(entity_id)
    );
    let existing = query_data(org_id, &query, true).await?;
    let ids = existing
        .get("records")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    for row in ids {
        if let Some(id) = get_string(&row, &["Id", "id"]) {
            delete_tooling_sobject(org_id, "TraceFlag", &id).await?;
        }
    }
    Ok(())
}

async fn post_tooling_sobject(org_id: &str, sobject: &str, body: &Value) -> anyhow::Result<Value> {
    let session = get_org_session(org_id).await?;
    let client = Client::new();
    let url = format!(
        "{}/services/data/v60.0/tooling/sobjects/{}/",
        session.instance_url, sobject
    );
    let resp = client
        .post(url)
        .bearer_auth(&session.access_token)
        .json(body)
        .send()
        .await?;
    let status = resp.status();
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!("创建 {} 失败: {}", sobject, json);
    }
    Ok(json)
}

async fn delete_tooling_sobject(org_id: &str, sobject: &str, id: &str) -> anyhow::Result<()> {
    let session = get_org_session(org_id).await?;
    let client = Client::new();
    let url = format!(
        "{}/services/data/v60.0/tooling/sobjects/{}/{}",
        session.instance_url, sobject, id
    );
    let resp = client
        .delete(url)
        .bearer_auth(&session.access_token)
        .send()
        .await?;
    let status = resp.status();
    if !status.is_success() {
        // Tolerate already-deleted flags: Salesforce often returns 404 / ENTITY_IS_DELETED
        // for stale TraceFlags that the background cleaner has already reaped but that still
        // appear in tooling SOQL results.
        let body = resp.text().await.unwrap_or_default();
        let already_gone = status.as_u16() == 404
            || body.contains("NOT_FOUND")
            || body.contains("ENTITY_IS_DELETED")
            || body.contains("INVALID_CROSS_REFERENCE_KEY");
        if !already_gone {
            anyhow::bail!("删除 {} 失败: {}", sobject, body);
        }
    }
    Ok(())
}

async fn query_data(org_id: &str, soql: &str, tooling: bool) -> anyhow::Result<Value> {
    let session = get_org_session(org_id).await?;
    let client = Client::new();
    let endpoint = if tooling { "tooling/query" } else { "query" };
    let url = format!(
        "{}/services/data/v60.0/{}?q={}",
        session.instance_url,
        endpoint,
        urlencoding::encode(soql)
    );
    let resp = client
        .get(url)
        .bearer_auth(&session.access_token)
        .send()
        .await?;
    let status = resp.status();
    let json: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        anyhow::bail!("SOQL 请求失败: {}", json);
    }
    Ok(json)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrgInstanceEnvelope {
    result: OrgInstanceResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrgInstanceResult {
    instance_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessTokenEnvelope {
    result: AccessTokenResult,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccessTokenResult {
    access_token: String,
}

#[derive(Debug, Clone)]
struct OrgDisplayResult {
    access_token: String,
    instance_url: String,
}

async fn get_org_session(org_id: &str) -> anyhow::Result<OrgDisplayResult> {
    // sf CLI v2.138+ hides accessToken from `sf org display` output. We must call the
    // dedicated `sf org auth show-access-token` command instead. instanceUrl still comes
    // from `sf org display` (no --verbose needed; instanceUrl is not a secret).
    let display_output = run_command(&["org", "display", "--target-org", org_id], true).await?;
    if !display_output.success {
        anyhow::bail!(
            "{}",
            cli_error_message(&display_output.stderr, &display_output.stdout)
        );
    }
    let display_parsed: OrgInstanceEnvelope =
        serde_json::from_str(&display_output.stdout).context("解析 org display 失败")?;

    let token_output = run_command(
        &["org", "auth", "show-access-token", "--target-org", org_id],
        true,
    )
    .await?;
    if !token_output.success {
        anyhow::bail!(
            "获取 accessToken 失败: {}",
            cli_error_message(&token_output.stderr, &token_output.stdout)
        );
    }
    let token_parsed: AccessTokenEnvelope =
        serde_json::from_str(&token_output.stdout).context("解析 access-token 失败")?;

    Ok(OrgDisplayResult {
        instance_url: display_parsed.result.instance_url,
        access_token: token_parsed.result.access_token,
    })
}
