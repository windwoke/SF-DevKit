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

    for org in all_orgs {
        let org_type = if org.expiration_date.is_some() {
            "scratch"
        } else if org.instance_url.contains("sandbox") {
            "sandbox"
        } else {
            "production"
        };
        sqlx::query(
            r#"
            INSERT INTO org_auth (id, alias, instance_url, org_type, expires_at, last_used)
            VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
              alias = excluded.alias,
              instance_url = excluded.instance_url,
              org_type = excluded.org_type,
              expires_at = excluded.expires_at,
              last_used = datetime('now')
            "#,
        )
        .bind(org.username)
        .bind(org.alias)
        .bind(org.instance_url)
        .bind(org_type)
        .bind(org.expiration_date)
        .execute(pool)
        .await?;
    }

    sync_default_org_from_cli(pool).await?;
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
    sync_default_org_from_cli(pool).await?;
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

pub async fn login_org(
    pool: &SqlitePool,
    alias: Option<String>,
    login_domain: &str,
) -> anyhow::Result<Vec<OrgAuth>> {
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
    sync_orgs(pool).await
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

    sqlx::query("UPDATE org_auth SET is_default = 0")
        .execute(pool)
        .await?;
    sqlx::query("UPDATE org_auth SET is_default = 1 WHERE id = ?1")
        .bind(default_org)
        .execute(pool)
        .await?;
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
