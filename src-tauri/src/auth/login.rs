use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tokio::io::AsyncReadExt;
use tokio::process::Command;

use super::manager;
use crate::cli::runner::{find_sf, run_command, SuppressConsole};

static LOGIN_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static CANCELLED: AtomicBool = AtomicBool::new(false);

/// One request shape for both initial login and reauthorization. Secrets are
/// deliberately excluded from Debug implementations and persisted profiles.
#[derive(Deserialize)]
#[serde(
    tag = "authMethod",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LoginRequest {
    Web {
        alias: Option<String>,
        #[serde(default = "default_true")]
        set_default: bool,
        login_domain: String,
        instance_url: Option<String>,
        consumer_key: Option<String>,
        consumer_secret: Option<String>,
        port: Option<u16>,
    },
    Jwt {
        alias: Option<String>,
        #[serde(default = "default_true")]
        set_default: bool,
        username: String,
        client_id: String,
        jwt_key_file: String,
        instance_url: String,
    },
}

fn default_true() -> bool {
    true
}

impl LoginRequest {
    fn should_set_default(&self, reauthorizing: bool) -> bool {
        !reauthorizing
            && match self {
                Self::Web { set_default, .. } | Self::Jwt { set_default, .. } => *set_default,
            }
    }
}

#[derive(Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct LoginProfile {
    pub username: String,
    pub client_id: String,
    pub jwt_key_file: String,
    pub instance_url: String,
}

pub const PROFILE_DDL: &str = "CREATE TABLE IF NOT EXISTS org_jwt_profiles (
    username TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    jwt_key_file TEXT NOT NULL,
    instance_url TEXT NOT NULL
)";

pub async fn get_profile(
    pool: &SqlitePool,
    username: &str,
) -> anyhow::Result<Option<LoginProfile>> {
    Ok(sqlx::query_as::<_, LoginProfile>(
        "SELECT username, client_id, jwt_key_file, instance_url FROM org_jwt_profiles WHERE username = ?1",
    )
    .bind(username)
    .fetch_optional(pool)
    .await?)
}

async fn save_profile(pool: &SqlitePool, profile: &LoginProfile) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO org_jwt_profiles (username, client_id, jwt_key_file, instance_url)
        VALUES (?1, ?2, ?3, ?4) ON CONFLICT(username) DO UPDATE SET
        client_id = excluded.client_id, jwt_key_file = excluded.jwt_key_file,
        instance_url = excluded.instance_url",
    )
    .bind(&profile.username)
    .bind(&profile.client_id)
    .bind(&profile.jwt_key_file)
    .bind(&profile.instance_url)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn clear_profile(pool: &SqlitePool, username: &str) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM org_jwt_profiles WHERE username = ?1")
        .bind(username)
        .execute(pool)
        .await?;
    Ok(())
}

pub fn request_cancel() {
    CANCELLED.store(true, Ordering::SeqCst);
}

struct LoginSession;

impl Drop for LoginSession {
    fn drop(&mut self) {
        if let Ok(mut pid) = manager::active_login().lock() {
            *pid = None;
        }
    }
}

/// The CLI owns credentials and token renewal. Only non-secret JWT settings
/// are saved here, after a confirmed successful login.
pub async fn login(
    pool: &SqlitePool,
    request: LoginRequest,
    expected_username: Option<&str>,
) -> anyhow::Result<()> {
    let _lock = LOGIN_LOCK
        .try_lock()
        .map_err(|_| anyhow::anyhow!("LOGIN_BUSY"))?;
    CANCELLED.store(false, Ordering::SeqCst);
    let _session = LoginSession;
    let previous_default = if !request.should_set_default(expected_username.is_some()) {
        read_default_org(pool).await?
    } else {
        None
    };
    if CANCELLED.load(Ordering::SeqCst) {
        anyhow::bail!("LOGIN_CANCELLED");
    }
    let result = authorize(pool, request, expected_username).await;
    // CLI AuthRemover can clear the default when changing an existing user's
    // auth type. Restore it in its original scope, even if authorization fails.
    if let Some((username, global)) = previous_default {
        let value = format!("target-org={username}");
        let mut args = vec!["config", "set", value.as_str()];
        if global {
            args.push("--global");
        }
        let output = run_command(&args, true).await;
        if !output.is_ok_and(|output| output.success) {
            anyhow::bail!("LOGIN_DEFAULT_RESTORE_FAILED");
        }
    }
    result
}

async fn read_default_org(pool: &SqlitePool) -> anyhow::Result<Option<(String, bool)>> {
    let output = run_command(&["config", "get", "target-org"], true).await?;
    if !output.success {
        anyhow::bail!("LOGIN_DEFAULT_READ_FAILED");
    }
    let json: serde_json::Value = serde_json::from_str(&output.stdout)
        .map_err(|_| anyhow::anyhow!("LOGIN_DEFAULT_READ_FAILED"))?;
    let Some((value, global)) = default_org_snapshot(&json) else {
        return Ok(None);
    };
    // An auth-type switch can remove aliases. Preserve the account identity.
    let username: Option<String> =
        sqlx::query_scalar("SELECT id FROM org_auth WHERE id = ?1 OR alias = ?1 LIMIT 1")
            .bind(&value)
            .fetch_optional(pool)
            .await?;
    Ok(Some((username.unwrap_or(value), global)))
}

fn default_org_snapshot(json: &serde_json::Value) -> Option<(String, bool)> {
    json["result"].as_array()?.iter().find_map(|item| {
        let value = item["value"].as_str()?;
        if item["name"] == "target-org" && !value.trim().is_empty() {
            Some((
                value.to_owned(),
                item["location"]
                    .as_str()
                    .is_some_and(|scope| scope.eq_ignore_ascii_case("global")),
            ))
        } else {
            None
        }
    })
}

async fn authorize(
    pool: &SqlitePool,
    request: LoginRequest,
    expected_username: Option<&str>,
) -> anyhow::Result<()> {
    let set_default = request.should_set_default(expected_username.is_some());
    match request {
        LoginRequest::Web {
            alias,
            set_default: _,
            login_domain,
            instance_url,
            consumer_key,
            consumer_secret,
            port,
        } => {
            let output = manager::login_org_web(
                alias,
                &login_domain,
                instance_url.as_deref(),
                consumer_key.as_deref(),
                consumer_secret.as_deref(),
                port,
                set_default,
            )
            .await?;
            if CANCELLED.load(Ordering::SeqCst) {
                anyhow::bail!("LOGIN_CANCELLED");
            }
            // Also clear a previous JWT preference when this user switches to
            // browser authorization, including via the Add Org dialog.
            if let Some(username) = web_username(&output) {
                if expected_username.is_some_and(|expected| expected != username) {
                    anyhow::bail!("LOGIN_USERNAME_MISMATCH");
                }
                clear_profile(pool, &username).await?;
                set_auth_method(pool, &username, "web").await?;
            }
        }
        LoginRequest::Jwt {
            alias,
            set_default: _,
            username,
            client_id,
            jwt_key_file,
            instance_url,
        } => {
            let profile = validate_profile(username, client_id, jwt_key_file, instance_url)?;
            if expected_username.is_some_and(|expected| expected != profile.username) {
                anyhow::bail!("LOGIN_USERNAME_MISMATCH");
            }
            let args = jwt_args(&profile, alias.as_deref(), set_default);
            run_jwt(&args, &profile.username).await?;
            save_profile(pool, &profile).await?;
            set_auth_method(pool, &profile.username, "jwt").await?;
        }
    }
    Ok(())
}

async fn set_auth_method(pool: &SqlitePool, username: &str, method: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE org_auth SET auth_method = ?1 WHERE id = ?2")
        .bind(method)
        .bind(username)
        .execute(pool)
        .await?;
    Ok(())
}

fn web_username(output: &str) -> Option<String> {
    let clean = strip_ansi_escapes::strip_str(output);
    regex::Regex::new(r"(?i)successfully (?:authorized|authenticated|logged in as)\s+(\S+)")
        .ok()?
        .captures(&clean)
        .map(|matches| matches[1].to_owned())
}

fn validate_profile(
    username: String,
    client_id: String,
    jwt_key_file: String,
    instance_url: String,
) -> anyhow::Result<LoginProfile> {
    let username = username.trim().to_owned();
    let client_id = client_id.trim().to_owned();
    if [&username, &client_id].iter().any(|value| {
        value.is_empty() || value.starts_with('-') || value.chars().any(char::is_whitespace)
    }) {
        anyhow::bail!("JWT_INVALID_CREDENTIALS");
    }
    let url =
        reqwest::Url::parse(instance_url.trim()).map_err(|_| anyhow::anyhow!("JWT_INVALID_URL"))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        anyhow::bail!("JWT_INVALID_URL");
    }
    let path = std::path::Path::new(jwt_key_file.trim());
    if !path.is_absolute() {
        anyhow::bail!("JWT_KEY_UNREADABLE");
    }
    let path = path
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("JWT_KEY_UNREADABLE"))?;
    let metadata = std::fs::metadata(&path).map_err(|_| anyhow::anyhow!("JWT_KEY_UNREADABLE"))?;
    if !metadata.is_file() || metadata.len() > 1024 * 1024 {
        anyhow::bail!("JWT_KEY_INVALID");
    }
    let key = std::fs::read_to_string(&path).map_err(|_| anyhow::anyhow!("JWT_KEY_UNREADABLE"))?;
    if !["PRIVATE KEY", "RSA PRIVATE KEY"].iter().any(|kind| {
        key.contains(&format!("-----BEGIN {kind}-----"))
            && key.contains(&format!("-----END {kind}-----"))
    }) {
        anyhow::bail!("JWT_KEY_INVALID");
    }
    Ok(LoginProfile {
        username,
        client_id,
        jwt_key_file: path.to_string_lossy().into_owned(),
        instance_url: url.as_str().trim_end_matches('/').to_owned(),
    })
}

fn jwt_args(profile: &LoginProfile, alias: Option<&str>, set_default: bool) -> Vec<String> {
    let mut args = vec![
        "org".into(),
        "login".into(),
        "jwt".into(),
        "--username".into(),
        profile.username.clone(),
        "--client-id".into(),
        profile.client_id.clone(),
        "--jwt-key-file".into(),
        profile.jwt_key_file.clone(),
        "--instance-url".into(),
        profile.instance_url.clone(),
        "--json".into(),
    ];
    if let Some(alias) = alias.map(str::trim).filter(|alias| !alias.is_empty()) {
        args.extend(["--alias".into(), alias.into()]);
    }
    if set_default {
        args.push("--set-default".into());
    }
    args
}

async fn run_jwt(args: &[String], username: &str) -> anyhow::Result<()> {
    let sf = find_sf().ok_or_else(|| anyhow::anyhow!("JWT_CLI_MISSING"))?;
    run_jwt_process(&sf, args, username, Duration::from_secs(120)).await
}

async fn run_jwt_process(
    binary: &std::path::Path,
    args: &[String],
    username: &str,
    timeout: Duration,
) -> anyhow::Result<()> {
    let mut child = Command::new(binary)
        .suppress_console()
        .args(args)
        .env("PATH", crate::cli::environment::runtime_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    *manager::active_login()
        .lock()
        .map_err(|_| anyhow::anyhow!("LOGIN_BUSY"))? = child.id();
    if CANCELLED.load(Ordering::SeqCst) {
        let _ = child.kill().await;
        anyhow::bail!("LOGIN_CANCELLED");
    }
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let mut output = Vec::new();
    let mut diagnostics = Vec::new();
    // Drain both pipes through EOF. JWT JSON can include access tokens, so no
    // process output is logged or returned to the frontend.
    let result = tokio::time::timeout(timeout, async {
        tokio::try_join!(
            child.wait(),
            stdout.read_to_end(&mut output),
            stderr.read_to_end(&mut diagnostics)
        )
    })
    .await;
    let pid = manager::active_login()
        .lock()
        .ok()
        .and_then(|mut pid| pid.take());
    if CANCELLED.load(Ordering::SeqCst) {
        let _ = child.kill().await;
        anyhow::bail!("LOGIN_CANCELLED");
    }
    match result {
        Ok(Ok((status, _, _))) => check_jwt_result(status.success(), &output, username),
        Ok(Err(error)) => Err(error.into()),
        Err(_) => {
            if let Some(pid) = pid {
                let _ = manager::kill_process(pid).await;
            }
            let _ = child.kill().await;
            anyhow::bail!("JWT_LOGIN_TIMEOUT");
        }
    }
}

fn check_jwt_result(success: bool, stdout: &[u8], username: &str) -> anyhow::Result<()> {
    let json: serde_json::Value =
        serde_json::from_slice(stdout).map_err(|_| anyhow::anyhow!("JWT_LOGIN_FAILED"))?;
    if !success || json["status"].as_i64() != Some(0) {
        // Return only a known error category; CLI error data may contain tokens
        // or the full signed assertion.
        anyhow::bail!(jwt_error_code(json["message"].as_str().unwrap_or_default()));
    }
    if json["result"]["username"].as_str() != Some(username) {
        anyhow::bail!("LOGIN_USERNAME_MISMATCH");
    }
    if json["result"]["orgId"]
        .as_str()
        .is_none_or(|id| id.is_empty())
    {
        anyhow::bail!("JWT_LOGIN_FAILED");
    }
    Ok(())
}

fn jwt_error_code(message: &str) -> &'static str {
    let message = message.to_lowercase();
    // Salesforce CLI aggregates failures from several login/audience pairs.
    // The selected My Domain is tried first. A later global-endpoint failure
    // must not replace that org's actual response with an audience diagnosis.
    let attempts = message
        .split_once("errors encountered:")
        .map(|(_, errors)| errors)
        .unwrap_or(&message);
    let cause = attempts
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if [
        "fetch failed",
        "econnrefused",
        "econnreset",
        "enotfound",
        "etimedout",
        "getaddrinfo",
        "socket hang up",
        "connect timeout",
        "self-signed certificate",
        "certificate chain",
        "unable to verify the first certificate",
    ]
    .iter()
    .any(|pattern| cause.contains(pattern))
    {
        "JWT_NETWORK_FAILED"
    } else if cause.contains("refresh_token")
        && cause.contains("scope")
        && (cause.contains("required") || cause.contains("missing"))
    {
        "JWT_SCOPE_OR_PREAUTH_REQUIRED"
    } else if cause.contains("hasn't approved")
        || cause.contains("has not approved")
        || cause.contains("not approved")
        || cause.contains("preauthorized")
        || cause.contains("pre-authorized")
    {
        "JWT_USER_NOT_APPROVED"
    } else if cause.contains("invalid client") || cause.contains("client identifier") {
        "JWT_INVALID_CLIENT"
    } else if cause.contains("signature") || cause.contains("certificate") {
        "JWT_INVALID_SIGNATURE"
    } else if cause.contains("audience") {
        "JWT_INVALID_AUDIENCE"
    } else {
        "JWT_LOGIN_FAILED"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const USER: &str = "developer@example.com";

    fn profile() -> LoginProfile {
        LoginProfile {
            username: USER.into(),
            client_id: "consumer-key".into(),
            jwt_key_file: "/a folder/private.key".into(),
            instance_url: "https://example.my.salesforce.com".into(),
        }
    }

    fn success_output() -> Vec<u8> {
        serde_json::to_vec(&json!({ "status": 0, "result": {
            "username": USER, "orgId": "00D000000000001", "accessToken": "never-expose-this-token"
        }}))
        .unwrap()
    }

    #[test]
    fn jwt_request_requires_credentials_and_rejects_unknown_method() {
        assert!(serde_json::from_value::<LoginRequest>(json!({"authMethod":"password"})).is_err());
        assert!(serde_json::from_value::<LoginRequest>(
            json!({"authMethod":"jwt","clientId":"key"})
        )
        .is_err());
        assert!(matches!(
            serde_json::from_value::<LoginRequest>(
                json!({"authMethod":"web","loginDomain":"production"})
            )
            .unwrap(),
            LoginRequest::Web { .. }
        ));
        assert!(matches!(serde_json::from_value::<LoginRequest>(json!({"authMethod":"jwt","username":USER,"clientId":"client","jwtKeyFile":"/file.key","instanceUrl":"https://login.salesforce.com"})).unwrap(), LoginRequest::Jwt { .. }));
    }

    #[test]
    fn reauthorization_never_sets_default_and_keeps_path_as_one_argument() {
        let args = jwt_args(&profile(), Some("  a useful alias  "), false);
        assert!(!args.iter().any(|arg| arg == "--set-default"));
        assert!(args
            .windows(2)
            .any(|args| args == ["--jwt-key-file", "/a folder/private.key"]));
        assert!(args
            .windows(2)
            .any(|args| args == ["--alias", "a useful alias"]));
        assert!(jwt_args(&profile(), None, true).contains(&"--set-default".into()));
        assert!(!jwt_args(&profile(), Some("  "), false).contains(&"--alias".into()));
    }

    #[test]
    fn unchecked_login_and_reauthorization_preserve_default_in_its_original_scope() {
        let global =
            json!({"result":[{"name":"target-org","value":"old-alias","location":"Global"}]});
        assert_eq!(
            default_org_snapshot(&global),
            Some(("old-alias".into(), true))
        );
        let local = json!({"result":[{"name":"target-org","value":USER,"location":"Local"}]});
        assert_eq!(default_org_snapshot(&local), Some((USER.into(), false)));
        assert_eq!(default_org_snapshot(&json!({"result":[] })), None);
        assert_eq!(
            default_org_snapshot(&json!({"result":[{"name":"target-org","value":null}]})),
            None
        );
    }

    #[test]
    fn default_selection_is_optional_for_both_methods_and_ignored_on_reauthorization() {
        for method in ["web", "jwt"] {
            for selected in [true, false] {
                let request: LoginRequest = serde_json::from_value(json!({
                    "authMethod": method, "setDefault": selected,
                    "loginDomain": "production", "username": USER,
                    "clientId": "client", "jwtKeyFile": "/file.key",
                    "instanceUrl": "https://example.my.salesforce.com"
                }))
                .unwrap();
                assert_eq!(request.should_set_default(false), selected);
                assert!(!request.should_set_default(true));
            }
            let legacy: LoginRequest = serde_json::from_value(json!({
                "authMethod": method, "loginDomain": "production", "username": USER,
                "clientId": "client", "jwtKeyFile": "/file.key",
                "instanceUrl": "https://example.my.salesforce.com"
            }))
            .unwrap();
            assert!(legacy.should_set_default(false));
        }
    }

    #[test]
    fn login_requires_process_success_json_success_and_matching_identity() {
        check_jwt_result(true, &success_output(), USER).unwrap();
        assert!(check_jwt_result(false, &success_output(), USER).is_err());
        assert!(check_jwt_result(true, br#"{"status":1,"message":"failure"}"#, USER).is_err());
        assert!(check_jwt_result(true, b"not json", USER).is_err());
        assert!(check_jwt_result(
            true,
            br#"{"status":0,"result":{"username":"developer@example.com"}}"#,
            USER
        )
        .is_err());
        assert_eq!(
            check_jwt_result(true, &success_output(), "other@example.com")
                .unwrap_err()
                .to_string(),
            "LOGIN_USERNAME_MISMATCH"
        );
    }

    #[test]
    fn authentication_errors_return_only_safe_actionable_categories() {
        for (message, expected) in [
            (
                "user hasn't approved this consumer",
                "JWT_USER_NOT_APPROVED",
            ),
            ("audience is invalid", "JWT_INVALID_AUDIENCE"),
            ("invalid assertion signature", "JWT_INVALID_SIGNATURE"),
            ("invalid client identifier", "JWT_INVALID_CLIENT"),
            ("other error", "JWT_LOGIN_FAILED"),
        ] {
            let output = serde_json::to_vec(&json!({ "status": 1,
                "message": format!("{message}; secret-token-and-signed-jwt"), "stack": "private-key-data" })).unwrap();
            assert_eq!(
                check_jwt_result(false, &output, USER)
                    .unwrap_err()
                    .to_string(),
                expected
            );
        }
    }

    #[test]
    fn cli_fallback_audience_errors_do_not_mask_the_selected_org_response() {
        for (first, expected) in [
            ("refresh_token scope is required and the connected app should be installed and preauthorized.", "JWT_SCOPE_OR_PREAUTH_REQUIRED"),
            ("client identifier invalid", "JWT_INVALID_CLIENT"),
            ("invalid assertion signature", "JWT_INVALID_SIGNATURE"),
            ("authentication failure", "JWT_LOGIN_FAILED"),
            ("fetch failed", "JWT_NETWORK_FAILED"),
            ("connect ECONNREFUSED 127.0.0.1:1234", "JWT_NETWORK_FAILED"),
            ("getaddrinfo ENOTFOUND example.my.sfcrmproducts.cn", "JWT_NETWORK_FAILED"),
            ("self-signed certificate in certificate chain", "JWT_NETWORK_FAILED"),
            ("user hasn't approved this consumer", "JWT_USER_NOT_APPROVED"),
        ] {
            let message = format!("We encountered a JSON web token error: JwtAuthError::Error authenticating with JWT.\nErrors encountered:\n{first}\nclient identifier invalid\naudience is invalid [audience=https://login.salesforce.com login=https://example.my.sfcrmproducts.cn/]\naudience is invalid [audience=https://test.salesforce.com login=https://example.my.sfcrmproducts.cn/]");
            let output = serde_json::to_vec(&json!({"status":1,"message":message,"data":{"assertion":"do-not-expose-fixture"}})).unwrap();
            assert_eq!(check_jwt_result(false, &output, USER).unwrap_err().to_string(), expected);
        }
        assert_eq!(
            jwt_error_code(
                "Error authenticating with JWT. Errors encountered:\naudience is invalid"
            ),
            "JWT_INVALID_AUDIENCE"
        );
    }

    #[test]
    fn validates_private_key_and_login_address_before_spawning_cli() {
        let temp = tempfile::tempdir().unwrap();
        let key = temp.path().join("server key.pem");
        std::fs::write(
            &key,
            "-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----",
        )
        .unwrap();
        let validate = |url: &str| {
            validate_profile(
                format!(" {USER} "),
                " client ".into(),
                key.to_string_lossy().into_owned(),
                url.into(),
            )
        };
        let valid = validate("https://example.my.salesforce.com/").unwrap();
        assert_eq!(valid.username, USER);
        assert_eq!(valid.instance_url, "https://example.my.salesforce.com");
        for url in [
            "https://example.my.sfcrmproducts.cn",
            "https://example--dev.sandbox.my.sfcrmproducts.cn",
        ] {
            let profile = validate(&format!("{url}/")).unwrap();
            assert_eq!(profile.instance_url, url);
            assert!(jwt_args(&profile, None, false)
                .windows(2)
                .any(|args| args == ["--instance-url", url]));
        }
        for url in [
            "http://login.salesforce.com",
            "https://user:secret@example.com",
            "https://example.com/a",
            "https://example.com?token=secret",
            "https://example.com/#fragment",
        ] {
            assert!(validate(url).is_err(), "{url}");
        }
        std::fs::write(
            &key,
            "-----BEGIN CERTIFICATE-----\npublic-cert\n-----END CERTIFICATE-----",
        )
        .unwrap();
        assert_eq!(
            validate("https://login.salesforce.com")
                .err()
                .unwrap()
                .to_string(),
            "JWT_KEY_INVALID"
        );
        std::fs::remove_file(&key).unwrap();
        assert_eq!(
            validate("https://login.salesforce.com")
                .err()
                .unwrap()
                .to_string(),
            "JWT_KEY_UNREADABLE"
        );
    }

    #[tokio::test]
    async fn saved_profiles_can_be_created_replaced_and_removed_idempotently() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query(PROFILE_DDL).execute(&pool).await.unwrap();
        sqlx::query(PROFILE_DDL).execute(&pool).await.unwrap();
        assert!(get_profile(&pool, USER).await.unwrap().is_none());
        save_profile(&pool, &profile()).await.unwrap();
        let mut changed = profile();
        changed.client_id = "rotated-client".into();
        save_profile(&pool, &changed).await.unwrap();
        let saved = get_profile(&pool, USER).await.unwrap().unwrap();
        assert_eq!(saved.client_id, "rotated-client");
        assert_eq!(saved.jwt_key_file, profile().jwt_key_file);
        clear_profile(&pool, USER).await.unwrap();
        assert!(get_profile(&pool, USER).await.unwrap().is_none());
    }

    #[test]
    fn browser_login_identity_supports_existing_success_formats() {
        for output in [
            format!("Successfully authorized {USER} with org ID 00D123"),
            format!("Successfully logged in as {USER}"),
            format!("\x1b[32mSuccessfully authenticated {USER}\x1b[0m"),
        ] {
            assert_eq!(web_username(&output), Some(USER.into()));
        }
        assert!(web_username("Waiting for browser sign-in").is_none());
    }

    #[tokio::test]
    async fn legacy_accounts_migrate_and_switch_methods_without_duplicate_rows_or_losing_settings()
    {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE org_auth (id TEXT PRIMARY KEY, alias TEXT, instance_url TEXT NOT NULL, org_type TEXT NOT NULL, is_default INTEGER, expires_at TEXT, connection_status TEXT, last_used TEXT, linked_project_path TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query(PROFILE_DDL).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO org_auth VALUES (?1, 'Dev', 'https://example.my.salesforce.com', 'production', 1, NULL, 'Connected', NULL, '/workspace/dev')")
            .bind(USER).execute(&pool).await.unwrap();
        save_profile(&pool, &profile()).await.unwrap();
        crate::db::init::migrate_org_auth_method(&pool)
            .await
            .unwrap();
        crate::db::init::migrate_org_auth_method(&pool)
            .await
            .unwrap();
        assert_eq!(
            manager::list_orgs(&pool).await.unwrap()[0].auth_method,
            "jwt"
        );
        for method in ["web", "jwt", "web"] {
            if method == "web" {
                clear_profile(&pool, USER).await.unwrap();
            } else {
                save_profile(&pool, &profile()).await.unwrap();
            }
            set_auth_method(&pool, USER, method).await.unwrap();
            let orgs = manager::list_orgs(&pool).await.unwrap();
            assert_eq!(orgs.len(), 1);
            let org = &orgs[0];
            assert_eq!(org.id, USER);
            assert_eq!(org.auth_method, method);
            assert_eq!(org.alias.as_deref(), Some("Dev"));
            assert_eq!(org.is_default, 1);
            assert_eq!(org.linked_project_path.as_deref(), Some("/workspace/dev"));
            assert!(!serde_json::to_string(org).unwrap().contains("private.key"));
        }
    }

    #[cfg(unix)]
    fn fixture_script(body: &str) -> (tempfile::TempDir, std::path::PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake sf");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        (dir, path)
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_drains_both_pipes_without_logging_or_truncating_json() {
        let _lock = LOGIN_LOCK.lock().await;
        let _session = LoginSession;
        CANCELLED.store(false, Ordering::SeqCst);
        let mut output: serde_json::Value = serde_json::from_slice(&success_output()).unwrap();
        output["result"]["accessToken"] = json!("x".repeat(150_000));
        let body = format!(
            "cat <<'ERROR' >&2\n{}\nERROR\ncat <<'JSON'\n{output}\nJSON",
            "warning".repeat(20_000)
        );
        let (_dir, script) = fixture_script(&body);
        run_jwt_process(&script, &[], USER, Duration::from_secs(5))
            .await
            .unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_timeout_terminates_cli() {
        let _lock = LOGIN_LOCK.lock().await;
        let _session = LoginSession;
        CANCELLED.store(false, Ordering::SeqCst);
        let (_dir, script) = fixture_script("exec sleep 5");
        let result = run_jwt_process(&script, &[], USER, Duration::from_millis(50)).await;
        assert_eq!(result.unwrap_err().to_string(), "JWT_LOGIN_TIMEOUT");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn process_cancellation_uses_existing_cancel_command() {
        let _lock = LOGIN_LOCK.lock().await;
        let _session = LoginSession;
        CANCELLED.store(false, Ordering::SeqCst);
        let (_dir, script) = fixture_script("exec sleep 5");
        let running = tokio::spawn(async move {
            run_jwt_process(&script, &[], USER, Duration::from_secs(5)).await
        });
        tokio::time::timeout(Duration::from_secs(2), async {
            while manager::active_login().lock().unwrap().is_none() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        manager::cancel_login().await.unwrap();
        assert_eq!(
            running.await.unwrap().unwrap_err().to_string(),
            "LOGIN_CANCELLED"
        );
    }
}
