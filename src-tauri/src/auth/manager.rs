use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::cli::runner::run_command;
use crate::db::models::OrgAuth;

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
        SELECT id, alias, instance_url, org_type, is_default, expires_at, last_used
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
    run_command(&arg_refs, false).await?;
    Ok(())
}

pub async fn open_org(username: &str) -> anyhow::Result<()> {
    run_command(&["org", "open", "--target-org", username], false).await?;
    Ok(())
}

fn login_instance_url(login_domain: &str) -> &'static str {
    match login_domain {
        "sandbox" => "https://test.salesforce.com",
        _ => "https://login.salesforce.com",
    }
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
