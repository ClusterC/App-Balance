//! Error handling shared by every Rust command.
//!
//! The spec requires Thai user-facing messages *and* detailed developer logs.
//! `AppError` therefore carries both: a short Thai sentence safe to show in a
//! snackbar, and a technical detail string that is logged and returned so a
//! user can paste it into a bug report.
//!
//! Two variants — [`AppError::InvalidInput`] and [`AppError::NotFound`] — carry
//! a Thai sentence chosen by the call site, because only the caller knows what
//! the user was doing. A generic "invalid input" would be useless in a dialog
//! that is asking for a transfer amount.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("file system error: {0}")]
    Io(#[from] std::io::Error),

    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("invalid backup: {0}")]
    InvalidBackup(String),

    /// A rule the user can fix, with the Thai explanation already written.
    #[error("invalid input: {0}")]
    InvalidInput(String),

    /// Something the caller expected to exist did not, with a Thai message.
    #[error("not found: {0}")]
    NotFound(String),
}

impl AppError {
    /// Thai message shown to the user. Kept short and non-technical.
    fn thai_message(&self) -> String {
        match self {
            AppError::Io(_) => "ไม่สามารถเข้าถึงไฟล์ได้ กรุณาตรวจสอบสิทธิ์การเข้าถึงโฟลเดอร์".into(),
            AppError::Database(_) => "เกิดข้อผิดพลาดในการเข้าถึงฐานข้อมูล".into(),
            AppError::Zip(_) => "ไฟล์สำรองข้อมูลเสียหายหรือไม่ใช่ไฟล์ของแอปนี้".into(),
            AppError::Json(_) => "ไฟล์ข้อมูลภายในไม่ถูกต้อง".into(),
            AppError::InvalidBackup(_) => "ไฟล์สำรองข้อมูลไม่ถูกต้อง".into(),
            // Written by the call site, in Thai, with the offending value named.
            AppError::InvalidInput(message) => message.clone(),
            AppError::NotFound(message) => message.clone(),
        }
    }
}

/// What the frontend receives when a command fails.
#[derive(Debug, Serialize)]
pub struct ErrorPayload {
    /// Thai, safe to display directly.
    pub message: String,
    /// Technical detail for logs and bug reports.
    pub detail: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        // Log the technical form so a developer can find it even if the UI
        // swallows the payload.
        eprintln!("[balance] command error: {self:#}");
        ErrorPayload {
            message: self.thai_message(),
            detail: format!("{self:#}"),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
