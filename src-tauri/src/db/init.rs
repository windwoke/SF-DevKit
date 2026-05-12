use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

pub fn init_db(app: &AppHandle) -> anyhow::Result<SqlitePool> {
    let app_dir: PathBuf = app
        .path()
        .app_data_dir()
        .context("failed to resolve app data dir")?;
    std::fs::create_dir_all(&app_dir).context("failed to create app data dir")?;

    let db_path = app_dir.join("sfdevkit.db");
    let rt = tokio::runtime::Runtime::new().context("failed to create runtime for DB init")?;
    let pool = rt.block_on(async move {
        let connect_options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.to_string_lossy()))
            .context("failed to build sqlite connect options")?
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(20)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(connect_options)
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
              linked_project_path TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_objects (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              api_name TEXT NOT NULL,
              label TEXT NOT NULL,
              is_custom INTEGER DEFAULT 0,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, api_name)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_fields (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              object_api_name TEXT NOT NULL,
              api_name TEXT NOT NULL,
              label TEXT NOT NULL,
              field_type TEXT NOT NULL,
              reference_to TEXT,
              relationship_name TEXT,
              is_nillable INTEGER DEFAULT 1,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, object_api_name, api_name)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_child_relationships (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              parent_object TEXT NOT NULL,
              relationship_name TEXT NOT NULL,
              child_object TEXT NOT NULL,
              field_name TEXT NOT NULL,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, parent_object, relationship_name)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_picklist_values (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              object_api_name TEXT NOT NULL,
              field_api_name TEXT NOT NULL,
              label TEXT NOT NULL,
              value TEXT NOT NULL,
              active INTEGER DEFAULT 1,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, object_api_name, field_api_name, value)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS metadata_types (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              xml_name TEXT NOT NULL,
              directory_name TEXT,
              suffix TEXT,
              in_folder INTEGER DEFAULT 0,
              group_name TEXT NOT NULL DEFAULT '',
              meta_file INTEGER DEFAULT 1,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, xml_name)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS metadata_components (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              metadata_type TEXT NOT NULL,
              full_name TEXT NOT NULL,
              file_name TEXT,
              last_modified TEXT,
              created_by_name TEXT,
              last_synced TEXT NOT NULL,
              UNIQUE(org_id, metadata_type, full_name)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS retrieve_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              selections_json TEXT NOT NULL,
              output_dir TEXT NOT NULL,
              api_version TEXT NOT NULL,
              output_mode TEXT NOT NULL,
              status TEXT NOT NULL,
              duration_ms INTEGER,
              log_text TEXT,
              executed_at TEXT DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS trace_targets (
              id TEXT PRIMARY KEY,
              org_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              label TEXT NOT NULL,
              entity_id TEXT NOT NULL,
              trace_flag_id TEXT,
              debug_level_id TEXT,
              expires_at TEXT,
              is_active INTEGER DEFAULT 0,
              created_at TEXT DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS sf_users_cache (
              id TEXT NOT NULL,
              org_id TEXT NOT NULL,
              name TEXT NOT NULL,
              username TEXT NOT NULL,
              cached_at TEXT DEFAULT (datetime('now')),
              PRIMARY KEY (id, org_id)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS log_downloads (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              org_id TEXT NOT NULL,
              log_id TEXT NOT NULL,
              file_path TEXT NOT NULL,
              file_size INTEGER,
              downloaded_at TEXT DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_components_type ON metadata_components(org_id, metadata_type);",
        )
        .execute(&pool)
        .await?;
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_components_name ON metadata_components(org_id, full_name);",
        )
        .execute(&pool)
        .await?;

        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS metadata_cache_meta (
              org_id TEXT NOT NULL,
              cache_key TEXT NOT NULL,
              value_int INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (org_id, cache_key)
            );
            "#,
        )
        .execute(&pool)
        .await?;

        for ddl in [
            "ALTER TABLE metadata_types ADD COLUMN directory_name TEXT",
            "ALTER TABLE metadata_types ADD COLUMN suffix TEXT",
            "ALTER TABLE metadata_types ADD COLUMN in_folder INTEGER DEFAULT 0",
            "ALTER TABLE metadata_types ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
            "ALTER TABLE metadata_types ADD COLUMN meta_file INTEGER DEFAULT 1",
            "ALTER TABLE metadata_types ADD COLUMN last_synced TEXT",
            "ALTER TABLE metadata_types ADD COLUMN parent_xml_name TEXT",
            "ALTER TABLE metadata_components ADD COLUMN file_name TEXT",
            "ALTER TABLE metadata_components ADD COLUMN last_modified TEXT",
            "ALTER TABLE metadata_components ADD COLUMN created_by_name TEXT",
            "ALTER TABLE metadata_components ADD COLUMN last_synced TEXT",
            "ALTER TABLE retrieve_history ADD COLUMN log_text TEXT",
            "ALTER TABLE retrieve_history ADD COLUMN executed_at TEXT",
        ] {
            if let Err(e) = sqlx::query(ddl).execute(&pool).await {
                let msg = e.to_string();
                if !msg.contains("duplicate column") {
                    return Err(anyhow::Error::from(e).context(format!("failed migration: {}", ddl)));
                }
            }
        }

        // Backfill legacy rows where group_name may be NULL.
        let _ = sqlx::query("UPDATE metadata_types SET group_name = '' WHERE group_name IS NULL")
            .execute(&pool)
            .await;

        if let Err(e) = sqlx::query("ALTER TABLE org_auth ADD COLUMN linked_project_path TEXT")
            .execute(&pool)
            .await
        {
            let msg = e.to_string();
            if !msg.contains("duplicate column") {
                return Err(anyhow::Error::from(e).context("failed to migrate org_auth.linked_project_path"));
            }
        }

        Ok::<SqlitePool, anyhow::Error>(pool)
    })?;

    Ok(pool)
}
