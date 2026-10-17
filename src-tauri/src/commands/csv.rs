//! CSV export.
//!
//! Written in Rust rather than the frontend for one specific reason: the file
//! must start with a UTF-8 BOM. Excel on Windows otherwise decodes the file
//! using the system ANSI codepage and renders Thai text as mojibake.
//!
//! The frontend decides *what* to export and picks the destination path via the
//! dialog plugin; this module only handles the encoding and the escaping.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use std::io::Write;
use std::path::PathBuf;

/// A single cell. Kept as a tagged enum so numbers and dates can be written
/// unquoted while text is escaped, without the frontend having to pre-format.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Cell {
    Text(String),
    Integer(i64),
    Real(f64),
    Empty,
}

impl Cell {
    /// RFC 4180 escaping: wrap in quotes when the value contains a comma,
    /// quote, CR or LF, and double any embedded quotes.
    fn render(&self) -> String {
        match self {
            Cell::Empty => String::new(),
            Cell::Integer(n) => n.to_string(),
            Cell::Real(n) => n.to_string(),
            Cell::Text(s) => {
                if s.contains([',', '"', '\n', '\r']) {
                    format!("\"{}\"", s.replace('"', "\"\""))
                } else {
                    s.to_string()
                }
            }
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CsvPayload {
    /// Destination path, chosen by the user through the save dialog.
    pub path: String,
    pub headers: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
}

/// Writes a CSV file as UTF-8 with a BOM and CRLF line endings.
///
/// CRLF is deliberate: it is what Excel and most Thai spreadsheet workflows
/// expect, and RFC 4180 specifies it.
#[tauri::command]
pub fn export_csv(payload: CsvPayload) -> AppResult<String> {
    let path = PathBuf::from(&payload.path);

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)?;
        }
    }

    let mut out: Vec<u8> = Vec::with_capacity(4096);

    // UTF-8 BOM — without this Excel mangles Thai characters.
    out.extend_from_slice(&[0xEF, 0xBB, 0xBF]);

    let mut line = String::with_capacity(256);
    let push_line = |out: &mut Vec<u8>, line: &mut String| -> std::io::Result<()> {
        line.push_str("\r\n");
        out.write_all(line.as_bytes())?;
        line.clear();
        Ok(())
    };

    for (i, header) in payload.headers.iter().enumerate() {
        if i > 0 {
            line.push(',');
        }
        line.push_str(&Cell::Text(header.clone()).render());
    }
    push_line(&mut out, &mut line)?;

    for row in &payload.rows {
        for (i, cell) in row.iter().enumerate() {
            if i > 0 {
                line.push(',');
            }
            line.push_str(&cell.render());
        }
        push_line(&mut out, &mut line)?;
    }

    std::fs::write(&path, &out).map_err(|e| {
        AppError::Io(std::io::Error::new(
            e.kind(),
            format!("could not write CSV to {}: {e}", path.display()),
        ))
    })?;

    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(cell: Cell) -> String {
        cell.render()
    }

    #[test]
    fn plain_text_is_unquoted() {
        assert_eq!(render(Cell::Text("อาหาร".into())), "อาหาร");
    }

    #[test]
    fn commas_and_quotes_are_escaped() {
        assert_eq!(render(Cell::Text("ค่าไฟ, ค่าน้ำ".into())), "\"ค่าไฟ, ค่าน้ำ\"");
        assert_eq!(
            render(Cell::Text("say \"hi\"".into())),
            "\"say \"\"hi\"\"\""
        );
    }

    #[test]
    fn newlines_force_quoting() {
        assert_eq!(render(Cell::Text("a\nb".into())), "\"a\nb\"");
    }

    #[test]
    fn numbers_are_written_bare() {
        assert_eq!(render(Cell::Integer(-123456)), "-123456");
        assert_eq!(render(Cell::Empty), "");
    }
}
