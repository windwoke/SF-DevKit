pub mod init;
pub mod models;

#[derive(Clone)]
pub struct DbState(pub sqlx::SqlitePool);
