//! OS file-drop routing for the interactive terminal.
//!
//! The window-level Tauri drag event arrives in Rust before the WebView can
//! process DOM drag handlers.  Terminal panes therefore publish their physical
//! screen bounds here.  The native event bridge can then route a drop to the
//! matching pane without opening Quick Chat first.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

const MAX_TARGET_ID_BYTES: usize = 256;
const MAX_TARGETS: usize = 32;
const MAX_PATHS_PER_DROP: usize = 128;
const MAX_TERMINAL_INPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDropTarget {
    pub target_id: String,
    /// Physical coordinates relative to the WebView top-left corner. Tauri's
    /// native drag event reports the cursor in this same coordinate space.
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalDropHoverEvent {
    pub target_id: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TerminalFileDropEvent {
    pub target_id: String,
    /// Already escaped for the shell the terminal actually launches. The
    /// renderer must inject it through xterm's paste API, never raw PTY input.
    pub input: String,
}

fn targets() -> &'static Mutex<HashMap<String, TerminalDropTarget>> {
    static TARGETS: OnceLock<Mutex<HashMap<String, TerminalDropTarget>>> = OnceLock::new();
    TARGETS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn valid_dimension(value: f64) -> bool {
    value.is_finite() && value > 0.0 && value <= 100_000.0
}

fn validate_target(mut target: TerminalDropTarget) -> Result<TerminalDropTarget, String> {
    target.target_id = target.target_id.trim().to_string();
    if target.target_id.is_empty() || target.target_id.len() > MAX_TARGET_ID_BYTES {
        return Err("invalid terminal drop target id".to_string());
    }
    if !target.x.is_finite()
        || !target.y.is_finite()
        || !valid_dimension(target.width)
        || !valid_dimension(target.height)
    {
        return Err("invalid terminal drop target bounds".to_string());
    }
    Ok(target)
}

#[tauri::command]
pub fn upsert_terminal_drop_target(target: TerminalDropTarget) -> Result<(), String> {
    let target = validate_target(target)?;
    let mut registry = targets()
        .lock()
        .map_err(|_| "terminal drop target registry lock poisoned".to_string())?;
    if !registry.contains_key(&target.target_id) && registry.len() >= MAX_TARGETS {
        return Err("too many terminal drop targets".to_string());
    }
    registry.insert(target.target_id.clone(), target);
    Ok(())
}

#[tauri::command]
pub fn remove_terminal_drop_target(target_id: String) -> Result<(), String> {
    if target_id.len() > MAX_TARGET_ID_BYTES {
        return Err("invalid terminal drop target id".to_string());
    }
    let mut registry = targets()
        .lock()
        .map_err(|_| "terminal drop target registry lock poisoned".to_string())?;
    registry.remove(&target_id);
    Ok(())
}

/// Return the terminal target matching a WebView-local physical position.
pub fn target_at(x: f64, y: f64) -> Option<String> {
    targets().lock().ok()?.values().find_map(|target| {
        let within_x = x >= target.x && x <= target.x + target.width;
        let within_y = y >= target.y && y <= target.y + target.height;
        (within_x && within_y).then(|| target.target_id.clone())
    })
}

pub fn emit_hover(app: &AppHandle, target_id: Option<String>) {
    let _ = app.emit(
        "aegis:terminal-drag-target",
        TerminalDropHoverEvent { target_id },
    );
}

pub fn clear_hover(app: &AppHandle) {
    emit_hover(app, None);
}

fn posix_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Match the familiar Terminal.app / Kooky drag text: keep ordinary paths
/// readable while backslash-escaping POSIX metacharacters. A literal newline
/// needs quoting because `\\\n` would silently become a line continuation.
fn posix_path_escape(value: &str) -> String {
    if value.contains('\n') || value.contains('\r') {
        return posix_quote(value);
    }

    let mut output = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(
            character,
            ' ' | '\t'
                | '\\'
                | '\"'
                | '\''
                | '`'
                | '$'
                | '('
                | ')'
                | '|'
                | '&'
                | ';'
                | '<'
                | '>'
                | '*'
                | '?'
                | '['
                | ']'
                | '{'
                | '}'
                | '~'
                | '!'
                | '#'
        ) {
            output.push('\\');
        }
        output.push(character);
    }
    output
}

#[cfg(windows)]
fn powershell_path_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(windows)]
fn cmd_path_escape(value: &str) -> String {
    // `"` is illegal in a Windows filename. Escape the remaining cmd
    // metacharacters even though most are inert inside double quotes: this
    // also protects the fallback command processor when delayed expansion is
    // enabled by a user's profile.
    let mut output = String::with_capacity(value.len() + 2);
    output.push('"');
    for character in value.chars() {
        if matches!(
            character,
            '^' | '&' | '|' | '<' | '>' | '(' | ')' | '%' | '!'
        ) {
            output.push('^');
        }
        output.push(character);
    }
    output.push('"');
    output
}

#[cfg(windows)]
fn uses_powershell() -> bool {
    let shell = crate::platform::default_shell_command();
    let program = std::path::Path::new(&shell.program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    program.contains("powershell") || program.starts_with("pwsh")
}

pub(crate) fn escaped_paths_for_current_shell(paths: &[PathBuf]) -> Option<String> {
    let values: Vec<String> = paths
        .iter()
        .take(MAX_PATHS_PER_DROP)
        .map(|path| path.to_string_lossy().into_owned())
        .filter(|path| !path.is_empty())
        .collect();
    if values.is_empty() {
        return None;
    }

    #[cfg(windows)]
    let escaped: Vec<String> = {
        let escape = if uses_powershell() {
            powershell_path_escape as fn(&str) -> String
        } else {
            cmd_path_escape as fn(&str) -> String
        };
        values.iter().map(|path| escape(path)).collect()
    };

    #[cfg(not(windows))]
    let escaped: Vec<String> = values.iter().map(|path| posix_path_escape(path)).collect();

    let input = escaped.join(" ");
    (input.len() <= MAX_TERMINAL_INPUT_BYTES).then_some(input)
}

fn change_directory_command(path: &Path) -> Option<String> {
    let escaped = escaped_paths_for_current_shell(&[path.to_path_buf()])?;
    #[cfg(windows)]
    {
        return Some(if uses_powershell() {
            format!("Set-Location -LiteralPath {escaped}\r")
        } else {
            format!("cd /d {escaped}\r")
        });
    }
    #[cfg(not(windows))]
    {
        Some(format!("cd -- {escaped}\r"))
    }
}

/// Build a safe shell command that changes the active terminal's directory.
/// The path must exist locally; callers fall back to their original command if
/// the selected File Manager root has disappeared in the meantime.
#[tauri::command]
pub fn terminal_change_directory_command(path: String) -> Result<String, String> {
    let candidate = PathBuf::from(path);
    if !candidate.is_dir() {
        return Err("terminal directory does not exist".to_string());
    }
    let canonical = candidate.canonicalize().unwrap_or(candidate);
    change_directory_command(&canonical)
        .ok_or_else(|| "could not format terminal directory command".to_string())
}

pub fn emit_file_drop(app: &AppHandle, target_id: String, paths: &[PathBuf]) -> bool {
    let Some(input) = escaped_paths_for_current_shell(paths) else {
        return false;
    };
    app.emit(
        "aegis:terminal-file-dropped",
        TerminalFileDropEvent { target_id, input },
    )
    .is_ok()
}

#[cfg(test)]
mod tests {
    use super::{
        change_directory_command, posix_path_escape, posix_quote, target_at, targets,
        terminal_change_directory_command, TerminalDropTarget,
    };
    use std::path::Path;

    #[test]
    fn posix_path_escape_preserves_readable_dragged_paths() {
        assert_eq!(posix_path_escape("/tmp/a b/$file"), "/tmp/a\\ b/\\$file");
        assert_eq!(posix_path_escape("/tmp/it's.txt"), "/tmp/it\\'s.txt");
        assert_eq!(posix_path_escape("/tmp/a\nb"), posix_quote("/tmp/a\nb"));
    }

    #[test]
    fn target_lookup_uses_physical_bounds() {
        let mut registry = targets().lock().unwrap();
        registry.clear();
        registry.insert(
            "pane-one".to_string(),
            TerminalDropTarget {
                target_id: "pane-one".to_string(),
                x: 100.0,
                y: 200.0,
                width: 300.0,
                height: 240.0,
            },
        );
        drop(registry);

        assert_eq!(target_at(101.0, 201.0).as_deref(), Some("pane-one"));
        assert_eq!(target_at(400.0, 440.0).as_deref(), Some("pane-one"));
        assert_eq!(target_at(99.0, 200.0), None);
    }

    #[cfg(not(windows))]
    #[test]
    fn posix_change_directory_command_uses_the_same_safe_path_format() {
        assert_eq!(
            change_directory_command(Path::new("/tmp/a b")),
            Some("cd -- /tmp/a\\ b\r".to_string()),
        );
    }

    #[test]
    fn change_directory_command_rejects_a_missing_directory() {
        let missing = std::env::temp_dir().join(format!("junqi-missing-{}", uuid::Uuid::new_v4()));
        assert!(terminal_change_directory_command(missing.to_string_lossy().into_owned()).is_err());
    }
}
