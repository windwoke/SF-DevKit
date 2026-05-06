use std::path::PathBuf;

use anyhow::Context;
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub fn init_db(app: &AppHandle) -> anyhow::Result<SqlitePool> {
    let app_dir: PathBuf = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?;
    std::fs::create_dir_all(&app_dir).context("failed to create app data dir")?;

    let db_path = app_dir.join("sfdevkit.db");
    let db_url = format!("sqlite://{}", db_path.to_string_lossy());

    let rt = tokio::runtime::Runtime::new().context("failed to create runtime for DB init")?;
    let pool = rt.block_on(async move {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(&db_url)
            .await
            .context("failed to connect sqlite")?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS org_auth (
              id TEXT PRIMARY KEY,
              alias TEXT,
              instance_url TEXT NOT NULL,
              org_type TEXT NOT NULL,
              is_default INTEGER DEFAULT 0,
              expires_at TEXT,
              last_used TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await?;

        Ok::<SqlitePool, anyhow::Error>(pool)
    })?;

    Ok(pool)
}
