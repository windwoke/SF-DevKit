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
    sqlx::query("UPDATE org_auth SET is_default = 0")
        .execute(pool)
        .await?;
    sqlx::query("UPDATE org_auth SET is_default = 1 WHERE id = ?1")
        .bind(username)
        .execute(pool)
        .await?;
    run_command(&["config", "set", "target-org", username], false).await?;
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

pub async fn login_org(pool: &SqlitePool) -> anyhow::Result<Vec<OrgAuth>> {
    run_command(&["org", "login", "web"], false).await?;
    sync_orgs(pool).await
}
