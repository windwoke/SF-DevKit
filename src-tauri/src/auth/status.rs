use std::time::Duration;

use sqlx::SqlitePool;

use crate::cli::runner::{find_sf, run_command};
use crate::db::models::OrgAuth;

#[derive(Debug, PartialEq)]
enum LoginStatus {
    Connected,
    Expired,
    Unreachable,
    Unknown,
}

impl LoginStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Connected => "Connected",
            Self::Expired => "Expired",
            Self::Unreachable => "Unreachable",
            Self::Unknown => "Unknown",
        }
    }
}

/// Verify this account with a read-only query. `org display` can succeed with
/// cached credentials even when its token refresh failed, so it is not a probe.
pub async fn check(pool: &SqlitePool, username: &str) -> anyhow::Result<OrgAuth> {
    load_org(pool, username).await?;
    if find_sf().is_none() {
        anyhow::bail!("ORG_CHECK_CLI_MISSING");
    }
    let args = [
        "data",
        "query",
        "--target-org",
        username,
        "--query",
        "SELECT Id FROM Organization LIMIT 1",
    ];
    let status = match tokio::time::timeout(Duration::from_secs(45), run_command(&args, true)).await
    {
        Ok(Ok(output)) => classify(output.success, &output.stdout),
        Ok(Err(_)) => anyhow::bail!("ORG_CHECK_FAILED"),
        Err(_) => LoginStatus::Unreachable,
    };
    save_status(pool, username, status).await
}

async fn load_org(pool: &SqlitePool, username: &str) -> anyhow::Result<OrgAuth> {
    sqlx::query_as::<_, OrgAuth>("SELECT id, alias, instance_url, org_type, auth_method, is_default, expires_at, connection_status, last_used, linked_project_path FROM org_auth WHERE id = ?1")
        .bind(username).fetch_optional(pool).await?
        .ok_or_else(|| anyhow::anyhow!("ORG_CHECK_NOT_FOUND"))
}

async fn save_status(
    pool: &SqlitePool,
    username: &str,
    status: LoginStatus,
) -> anyhow::Result<OrgAuth> {
    // Do not change defaults, aliases, auth preferences, or any other account.
    sqlx::query("UPDATE org_auth SET connection_status = ?1 WHERE id = ?2")
        .bind(status.as_str())
        .bind(username)
        .execute(pool)
        .await?;
    load_org(pool, username).await
}

fn classify(success: bool, stdout: &str) -> LoginStatus {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout) else {
        return LoginStatus::Unknown;
    };
    if success && json["status"].as_i64() == Some(0) {
        return if json["result"]["records"].as_array().is_some_and(|records| {
            records
                .iter()
                .any(|record| record["Id"].as_str().is_some_and(|id| !id.is_empty()))
        }) {
            LoginStatus::Connected
        } else {
            LoginStatus::Unknown
        };
    }
    // Keep raw CLI diagnostics, which can contain tokens/assertions, internal.
    let name = json["name"].as_str().unwrap_or_default().to_lowercase();
    let message = json["message"].as_str().unwrap_or_default().to_lowercase();
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
        "econn",
        "enotfound",
        "etimedout",
        "getaddrinfo",
        "network",
        "socket",
        "timeout",
        "timed out",
        "self-signed certificate",
        "certificate chain",
        "unable to verify the first certificate",
        "maintenance",
    ]
    .iter()
    .any(|pattern| cause.contains(pattern) || name.contains(pattern))
    {
        return LoginStatus::Unreachable;
    }
    if [
        "invalid_session_id",
        "invalidsessionid",
        "invalid_grant",
        "invalid grant",
        "authentication failure",
        "not authenticated",
        "noauthinfo",
        "namedorgnotfound",
        "no auth info",
        "hasn't approved",
        "has not approved",
        "client identifier invalid",
        "invalid client",
        "expired",
        "signature",
        "audience",
        "refresh_token scope",
    ]
    .iter()
    .any(|pattern| cause.contains(pattern) || name.contains(pattern))
        || [
            "jwtgrant",
            "jwtauth",
            "refreshtokenauth",
            "invalidjwt",
            "invalidassertion",
        ]
        .iter()
        .any(|pattern| name.contains(pattern))
    {
        LoginStatus::Expired
    } else {
        // Permissions or an unexpected CLI failure do not prove auth expired.
        LoginStatus::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_a_successful_server_query_confirms_connection() {
        let result = json!({"status":0,"result":{"records":[{"Id":"00Dexample"}]}}).to_string();
        assert_eq!(classify(true, &result), LoginStatus::Connected);
        assert_ne!(classify(false, &result), LoginStatus::Connected);
        assert_eq!(
            classify(true, r#"{"status":0,"result":{"username":"cached"}}"#),
            LoginStatus::Unknown
        );
        assert_eq!(classify(true, "not JSON"), LoginStatus::Unknown);
    }

    #[test]
    fn separates_invalid_auth_from_network_and_permission_failures() {
        for (name, message, expected) in [
            (
                "INVALID_SESSION_ID",
                "Session expired or invalid",
                LoginStatus::Expired,
            ),
            (
                "RefreshTokenAuthError",
                "invalid_grant: expired access/refresh token",
                LoginStatus::Expired,
            ),
            (
                "NamedOrgNotFoundError",
                "No authorization information",
                LoginStatus::Expired,
            ),
            (
                "JwtGrantError",
                "Errors encountered:\ninvalid assertion signature\nfetch failed",
                LoginStatus::Expired,
            ),
            (
                "JwtGrantError",
                "Errors encountered:\nfetch failed\nclient identifier invalid",
                LoginStatus::Unreachable,
            ),
            (
                "Error",
                "getaddrinfo ENOTFOUND example.com",
                LoginStatus::Unreachable,
            ),
            (
                "Error",
                "self-signed certificate in certificate chain",
                LoginStatus::Unreachable,
            ),
            (
                "INSUFFICIENT_ACCESS",
                "Insufficient privileges",
                LoginStatus::Unknown,
            ),
        ] {
            let output = json!({"status":1,"name":name,"message":message,"data":{"accessToken":"never-return","assertion":"never-return"}}).to_string();
            assert_eq!(classify(false, &output), expected, "{name}");
        }
    }

    #[tokio::test]
    async fn stores_only_selected_accounts_status_and_preserves_its_settings() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE org_auth (id TEXT PRIMARY KEY, alias TEXT, instance_url TEXT, org_type TEXT, auth_method TEXT, is_default INTEGER, expires_at TEXT, connection_status TEXT, last_used TEXT, linked_project_path TEXT)")
            .execute(&pool).await.unwrap();
        for username in ["first@example.com", "other@example.com"] {
            sqlx::query("INSERT INTO org_auth VALUES (?1, 'Dev', 'https://example.my.salesforce.com', 'production', 'jwt', 1, NULL, 'Connected', NULL, '/workspace/dev')")
                .bind(username).execute(&pool).await.unwrap();
        }
        let org = save_status(&pool, "first@example.com", LoginStatus::Expired)
            .await
            .unwrap();
        assert_eq!(org.connection_status, "Expired");
        assert_eq!(org.is_default, 1);
        assert_eq!(org.auth_method, "jwt");
        assert_eq!(org.alias.as_deref(), Some("Dev"));
        assert_eq!(org.linked_project_path.as_deref(), Some("/workspace/dev"));
        assert_eq!(
            load_org(&pool, "other@example.com")
                .await
                .unwrap()
                .connection_status,
            "Connected"
        );
        assert_eq!(
            save_status(&pool, "first@example.com", LoginStatus::Connected)
                .await
                .unwrap()
                .connection_status,
            "Connected"
        );
        assert_eq!(
            load_org(&pool, "missing").await.unwrap_err().to_string(),
            "ORG_CHECK_NOT_FOUND"
        );
    }
}
