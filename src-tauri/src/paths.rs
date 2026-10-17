//! Filesystem locations used by the app.
//!
//! Everything lives under the Tauri app-data directory — never inside the
//! project folder, and never anywhere that gets synced or committed.
//! On Windows this resolves to:
//!   `%APPDATA%\com.personal.balanceapp\`

use crate::error::{AppError, AppResult};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Absolute path of the live SQLite database file.
pub fn database_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::NotFound(format!("app config dir unavailable: {e}")))?;
    Ok(dir.join("balance.db"))
}

/// Directory the app owns for its own data.
pub fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map_err(|e| AppError::NotFound(format!("app config dir unavailable: {e}")))
}

/// A unique path inside the OS temp directory, for staging work that should not
/// survive a crash.
pub fn temp_path(suffix: &str) -> AppResult<PathBuf> {
    let mut p = std::env::temp_dir();
    p.push(format!("balance-{}-{}", uuid::Uuid::new_v4(), suffix));
    Ok(p)
}

/// `YYYY-MM-DD` in the local timezone, used for default backup file names.
pub fn today_local_date() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}
