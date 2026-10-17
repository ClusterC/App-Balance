//! Tauri commands exposed to the frontend.
//!
//! Submodules are public and referenced by full path from `generate_handler!`,
//! because `#[tauri::command]` emits a companion macro next to the function that
//! a plain `pub use` re-export would not carry.
//!
//! | Module | Responsibility |
//! |---|---|
//! | [`backup`] | ZIP backup, inspection, and the guarded restore swap |
//! | [`csv`] | UTF-8-with-BOM CSV writing, so Excel shows Thai correctly |
//! | [`db`] | Transactional writes — transfers and snapshot mutations |
//! | [`seed`] | Development-only sample data |

pub mod backup;
pub mod csv;
pub mod db;
pub mod seed;

use crate::SCHEMA_VERSION;
use serde::Serialize;

/// Build metadata for the in-app "เกี่ยวกับ" (About) screen.
#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub schema_version: i64,
    pub repository_url: String,
    pub database_path: String,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, crate::error::AppError> {
    let database_path = crate::paths::database_path(&app)?
        .to_string_lossy()
        .into_owned();

    Ok(AppInfo {
        name: app.package_info().name.clone(),
        version: app.package_info().version.to_string(),
        schema_version: SCHEMA_VERSION,
        repository_url: env!("CARGO_PKG_REPOSITORY").to_string(),
        database_path,
    })
}

/// Restarts the application.
///
/// Called by the frontend after a successful restore. The SQL plugin's
/// connection pool still holds a handle on the file that was just replaced, so
/// reopening the database in place is not enough — the process has to come back
/// up cleanly. Doing this in Rust avoids adding the `process` plugin for a
/// single call.
#[tauri::command]
pub fn restart_app(app: tauri::AppHandle) {
    app.restart();
}
