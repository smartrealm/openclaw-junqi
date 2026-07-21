//! Session-scoped Claude Code hooks for the embedded terminal.
//!
//! Kooky routes agent hooks by terminal surface id. JunQi uses the same
//! ownership rule, but transports one small JSON payload over loopback TCP so
//! the bridge works on Windows as well as Unix. Each application process owns
//! a random token; untrusted local clients cannot publish terminal activity.

use std::collections::BTreeMap;
use std::io::Read;
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;

use rand::RngCore;
use tauri::{AppHandle, Emitter, Manager};

const HOOK_EVENT_NAME: &str = "terminal-hook";
const MAX_HOOK_MESSAGE_BYTES: u64 = 16 * 1024;
const MAX_IDENTIFIER_BYTES: usize = 2 * 1024;
const TERMINAL_HOOK_SCRIPT: &str = include_str!("../assets/junqi-terminal-hook.mjs");

#[derive(Clone)]
struct TerminalHookBridge {
    port: u16,
    token: String,
    claude_settings_path: String,
}

#[derive(serde::Deserialize)]
struct IncomingHookEvent {
    token: String,
    surface: String,
    run_id: String,
    agent: String,
    kind: String,
    event: String,
    tool_name: Option<String>,
    identifier: Option<String>,
    success: Option<bool>,
    tool_use_id: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalHookEvent {
    shell_id: String,
    run_id: String,
    agent: String,
    kind: String,
    event: String,
    tool_name: Option<String>,
    identifier: Option<String>,
    success: Option<bool>,
    tool_use_id: Option<String>,
}

fn bridge_slot() -> &'static OnceLock<Result<TerminalHookBridge, String>> {
    static BRIDGE: OnceLock<Result<TerminalHookBridge, String>> = OnceLock::new();
    &BRIDGE
}

fn shell_command_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn hook_script_command(path: &str, windows: bool) -> String {
    if windows {
        format!("node \"{}\"", path.replace('"', "\\\""))
    } else {
        format!("node {}", shell_command_quote(path))
    }
}

fn valid_wire_value(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

fn optional_wire_value(value: Option<String>) -> Option<String> {
    value.filter(|value| valid_wire_value(value, MAX_IDENTIFIER_BYTES))
}

fn token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn write_hook_assets(app: &AppHandle) -> Result<String, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve terminal hook directory: {error}"))?
        .join("terminal-hooks");
    std::fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let script_path = root.join("junqi-terminal-hook.mjs");
    std::fs::write(&script_path, TERMINAL_HOOK_SCRIPT).map_err(|error| error.to_string())?;

    let command = hook_script_command(&script_path.to_string_lossy(), cfg!(windows));
    let lifecycle = || {
        serde_json::json!([
            { "hooks": [{ "type": "command", "command": command }] }
        ])
    };
    let settings = serde_json::json!({
        "hooks": {
            "SessionStart": lifecycle(),
            "UserPromptSubmit": lifecycle(),
            "Stop": lifecycle(),
            "Notification": lifecycle(),
            "SessionEnd": lifecycle(),
            "PreToolUse": lifecycle(),
            "PostToolUse": lifecycle(),
            "PostToolUseFailure": lifecycle()
        }
    });
    let settings_path = root.join("claude.json");
    let serialized = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    std::fs::write(&settings_path, serialized).map_err(|error| error.to_string())?;
    Ok(settings_path.to_string_lossy().into_owned())
}

fn emit_incoming(app: &AppHandle, token: &str, message: IncomingHookEvent) {
    if message.token != token
        || !valid_wire_value(&message.surface, 256)
        || !valid_wire_value(&message.run_id, 256)
    {
        return;
    }

    let is_lifecycle = message.kind == "lifecycle"
        && matches!(message.event.as_str(), "running" | "attention" | "ended");
    let is_tool = message.kind == "tool"
        && matches!(message.event.as_str(), "pre" | "post")
        && message
            .tool_name
            .as_deref()
            .is_some_and(|name| valid_wire_value(name, 128));
    if !is_lifecycle && !is_tool {
        return;
    }

    let event = TerminalHookEvent {
        shell_id: message.surface,
        run_id: message.run_id,
        agent: message.agent,
        kind: message.kind,
        event: message.event,
        tool_name: optional_wire_value(message.tool_name),
        identifier: optional_wire_value(message.identifier),
        success: is_tool.then_some(message.success).flatten(),
        tool_use_id: optional_wire_value(message.tool_use_id),
    };
    let _ = app.emit(HOOK_EVENT_NAME, event);
}

fn read_one(stream: &mut TcpStream, app: &AppHandle, token: &str) {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
    let mut bytes = Vec::new();
    let _ = stream.take(MAX_HOOK_MESSAGE_BYTES).read_to_end(&mut bytes);
    if let Ok(message) = serde_json::from_slice::<IncomingHookEvent>(&bytes) {
        emit_incoming(app, token, message);
    }
}

fn start_bridge(app: AppHandle) -> Result<TerminalHookBridge, String> {
    let claude_settings_path = write_hook_assets(&app)?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("bind terminal hook bridge: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("read terminal hook bridge address: {error}"))?
        .port();
    let token = token();
    let thread_app = app.clone();
    let thread_token = token.clone();
    thread::Builder::new()
        .name("junqi-terminal-hooks".to_string())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(mut stream) => read_one(&mut stream, &thread_app, &thread_token),
                    Err(_) => break,
                }
            }
        })
        .map_err(|error| format!("start terminal hook bridge: {error}"))?;
    Ok(TerminalHookBridge {
        port,
        token,
        claude_settings_path,
    })
}

/// Environment injected only into an interactive JunQi shell PTY.
pub fn session_environment(
    app: &AppHandle,
    shell_id: &str,
    run_id: &str,
) -> Result<BTreeMap<String, String>, String> {
    if !valid_wire_value(shell_id, 256) || !valid_wire_value(run_id, 256) {
        return Err("invalid terminal hook session identity".to_string());
    }
    let bridge = bridge_slot()
        .get_or_init(|| start_bridge(app.clone()))
        .as_ref()
        .map_err(Clone::clone)?;
    Ok(BTreeMap::from([
        ("JUNQI_HOOK_PORT".to_string(), bridge.port.to_string()),
        ("JUNQI_HOOK_TOKEN".to_string(), bridge.token.clone()),
        ("JUNQI_HOOK_RUN_ID".to_string(), run_id.to_string()),
        (
            "JUNQI_CLAUDE_SETTINGS".to_string(),
            bridge.claude_settings_path.clone(),
        ),
    ]))
}

#[cfg(test)]
mod tests {
    use super::{hook_script_command, optional_wire_value, shell_command_quote, valid_wire_value};

    #[test]
    fn hook_wire_validation_rejects_control_data() {
        assert!(valid_wire_value("shell:one", 256));
        assert!(!valid_wire_value("shell\nother", 256));
        assert_eq!(
            optional_wire_value(Some("readme.md".to_string())),
            Some("readme.md".to_string())
        );
        assert_eq!(optional_wire_value(Some("bad\u{0}".to_string())), None);
    }

    #[test]
    fn hook_shell_command_quote_keeps_paths_as_one_argument() {
        assert_eq!(
            shell_command_quote("/tmp/JunQi Hook.mjs"),
            "'/tmp/JunQi Hook.mjs'"
        );
        assert_eq!(shell_command_quote("/tmp/it's.mjs"), "'/tmp/it'\\''s.mjs'");
        assert_eq!(
            hook_script_command(r"C:\Users\Jun Qi\hook.mjs", true),
            r#"node "C:\Users\Jun Qi\hook.mjs""#
        );
    }
}
