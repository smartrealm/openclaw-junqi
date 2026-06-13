use crate::paths;
use crate::state::GatewayProcess;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
}

/// Build a PATH that includes bundled Node.js, our openclaw prefix,
/// and common native install locations — same approach as openclaw-desktop.
fn augmented_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    // Bundled Node.js
    parts.push(paths::node_bin_dir().to_string_lossy().to_string());
    // Our openclaw --prefix install
    parts.push(paths::desktop_dir().join("openclaw").join("bin").to_string_lossy().to_string());
    if let Some(home) = dirs::home_dir() {
        // Native npm installs
        parts.push(home.join(".npm-global").join("bin").to_string_lossy().to_string());
        parts.push(home.join(".local").join("bin").to_string_lossy().to_string());
        // asdf / mise version managers (shim node, npm, etc.)
        parts.push(home.join(".asdf").join("shims").to_string_lossy().to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// Resolve `openclaw` on the augmented PATH — same as desktop's resolveOpenclawBinary.
fn resolve_openclaw_binary() -> Option<std::path::PathBuf> {
    let path = augmented_path();
    let (cmd, arg) = if cfg!(windows) { ("where", "openclaw.cmd") } else { ("which", "openclaw") };
    std::process::Command::new(cmd)
        .arg(arg)
        .env("PATH", &path)
        .output()
        .ok()
        .and_then(|out| {
            if out.status.success() {
                let first = String::from_utf8_lossy(&out.stdout)
                    .lines().next()?.trim().to_string();
                if !first.is_empty() { return Some(std::path::PathBuf::from(first)); }
            }
            None
        })
}

/// Generate a random token for localhost gateway authentication.
///
/// Uses `RandomState` with a fresh OS-seeded key per round to produce
/// unpredictable 192-bit tokens. Adequate for loopback-only use where
/// the port is not exposed to the network.
pub(crate) fn generate_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut token = String::with_capacity(48);
    // Mix OS entropy (RandomState::new()) with timestamp nanos to prevent
    // identical tokens from rapid successive calls.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for i in 0..3 {
        let s = RandomState::new();
        let mut h = s.build_hasher();
        h.write_u64((ts ^ (i as u128)) as u64);
        token.push_str(&format!("{:016x}", h.finish()));
    }
    token
}

pub(crate) fn ensure_config_with_token(config_path: &std::path::Path, port: u16, bind: &str) -> Result<String, String> {
    // Origins that Tauri webviews may send depending on OS/version
    let allowed_origins = serde_json::json!([
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
        "http://localhost:5173"
    ]);

    // controlUi config: allow Tauri origins + disable device identity checks
    // (safe for local-only loopback gateway)
    let control_ui = serde_json::json!({
        "allowedOrigins": allowed_origins,
        "allowInsecureAuth": true,
        "dangerouslyDisableDeviceAuth": true
    });

    // Default workspace under maxauto dir for environment isolation
    let default_workspace = paths::default_workspace_dir();
    let default_workspace_str = default_workspace.to_str().unwrap();

    if config_path.exists() {
        // Read existing config and extract token
        let raw = std::fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse config: {}", e))?;

        // Try to get existing token
        if let Some(token) = config
            .get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|t| t.as_str())
        {
            let token = token.to_string();

            let mut config = config;

            // Ensure gateway.mode, bind, port, and controlUi config are set
            if let Some(gw) = config.get_mut("gateway").and_then(|g| g.as_object_mut()) {
                if !gw.contains_key("mode") {
                    gw.insert("mode".into(), serde_json::json!("local"));
                }

                // Always update bind and port to match the requested values
                // (critical for Docker mode where bind must be "lan" for 0.0.0.0)
                gw.insert("bind".into(), serde_json::json!(bind));
                gw.insert("port".into(), serde_json::json!(port));

                // Always update controlUi to ensure Tauri origins + insecure auth are present
                gw.insert("controlUi".into(), control_ui.clone());
            }

            std::fs::write(
                config_path,
                serde_json::to_string_pretty(&config).unwrap(),
            )
            .map_err(|e| format!("Failed to write config: {}", e))?;

            return Ok(token);
        }

        // Config exists but no token — add token auth
        let mut config = config;
        let gateway = config
            .as_object_mut()
            .ok_or("Config is not an object")?
            .entry("gateway")
            .or_insert_with(|| serde_json::json!({}));
        let gw_obj = gateway
            .as_object_mut()
            .ok_or("gateway is not an object")?;

        // Ensure gateway.mode is set
        gw_obj.entry("mode").or_insert_with(|| serde_json::json!("local"));

        // Always update bind and port to match the requested values
        gw_obj.insert("bind".into(), serde_json::json!(bind));
        gw_obj.insert("port".into(), serde_json::json!(port));

        // Ensure controlUi config
        gw_obj.insert("controlUi".into(), control_ui.clone());

        let auth = gw_obj
            .entry("auth")
            .or_insert_with(|| serde_json::json!({}));
        let auth_obj = auth
            .as_object_mut()
            .ok_or("auth is not an object")?;
        let token = generate_token();
        auth_obj.insert("mode".into(), serde_json::json!("token"));
        auth_obj.insert("token".into(), serde_json::json!(token));

        std::fs::write(
            config_path,
            serde_json::to_string_pretty(&config).unwrap(),
        )
        .map_err(|e| format!("Failed to write config: {}", e))?;

        return Ok(token);
    }

    // Config doesn't exist — create with token
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let token = generate_token();
    let default_config = serde_json::json!({
        "agents": {
            "defaults": {
                "workspace": default_workspace_str
            }
        },
        "gateway": {
            "mode": "local",
            "port": port,
            "bind": bind,
            "auth": {
                "mode": "token",
                "token": token
            },
            "controlUi": control_ui
        }
    });
    std::fs::write(
        config_path,
        serde_json::to_string_pretty(&default_config).unwrap(),
    )
    .map_err(|e| format!("Failed to write default config: {}", e))?;

    Ok(token)
}

/// Ensure all paired devices have full operator scopes.
///
/// Internal gateway calls (e.g. from sessions_spawn subagents) use
/// CLI_DEFAULT_OPERATOR_SCOPES which includes admin/read/write/approvals/pairing.
/// If a device was initially paired with limited scopes (e.g. only "operator.read"),
/// subsequent connections requesting wider scopes trigger a "scope-upgrade" pairing
/// request. The gateway never silently auto-approves scope upgrades (silent=false is
/// hardcoded), so the connection fails with "pairing required" (1008).
///
/// This function patches paired.json at startup to grant full operator scopes to all
/// operator-role devices, preventing scope-upgrade pairing failures.
fn ensure_paired_devices_full_scopes(base_dir: &std::path::Path) {
    let paired_path = base_dir.join("devices").join("paired.json");
    if !paired_path.exists() {
        return;
    }
    let raw = match std::fs::read_to_string(&paired_path) {
        Ok(r) => r,
        Err(_) => return,
    };
    let mut doc: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    let full_scopes = serde_json::json!([
        "operator.admin",
        "operator.read",
        "operator.write",
        "operator.approvals",
        "operator.pairing"
    ]);
    let mut changed = false;
    if let Some(obj) = doc.as_object_mut() {
        for (_device_id, entry) in obj.iter_mut() {
            if let Some(entry_obj) = entry.as_object_mut() {
                // Only patch operator-role devices
                let is_operator = entry_obj
                    .get("role")
                    .and_then(|r| r.as_str())
                    .map_or(false, |r| r == "operator");
                if !is_operator {
                    continue;
                }
                // Patch scopes and approvedScopes to full set
                if entry_obj.get("approvedScopes") != Some(&full_scopes) {
                    entry_obj.insert("scopes".into(), full_scopes.clone());
                    entry_obj.insert("approvedScopes".into(), full_scopes.clone());
                    // Also update tokens to include full scopes
                    if let Some(tokens) = entry_obj.get_mut("tokens").and_then(|t| t.as_object_mut()) {
                        if let Some(op_token) = tokens.get_mut("operator").and_then(|t| t.as_object_mut()) {
                            op_token.insert("scopes".into(), full_scopes.clone());
                        }
                    }
                    changed = true;
                }
            }
        }
    }
    if changed {
        // Also clear pending requests since they may reference stale scope state
        let pending_path = base_dir.join("devices").join("pending.json");
        let _ = std::fs::write(&pending_path, "{}");
        let _ = std::fs::write(&paired_path, serde_json::to_string_pretty(&doc).unwrap());
    }
}

/// Read the gateway auth token from the config file
#[tauri::command]
pub async fn get_gateway_token() -> Result<String, String> {
    let config_path = paths::config_path();
    if !config_path.exists() {
        return Err("Config not found".into());
    }

    let raw = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No gateway token found in config".into())
}

/// Returns true if an OpenClaw gateway is already responding on the given port.
/// Used to detect the user's local gateway so we connect to it instead of
/// starting (or killing) a competing process.
async fn is_gateway_serving(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/healthz", port);
    matches!(reqwest::get(&url).await, Ok(resp) if resp.status().is_success())
}

#[tauri::command]
pub async fn start_gateway(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    port: Option<u16>,
) -> Result<GatewayStatus, String> {
    let port = port.unwrap_or(18789);

    // "Rely on local openclaw": if a gateway is already listening on this port
    // (the user's own `openclaw gateway`, hermes, etc.), connect to it — never
    // kill or restart an external process. Only start our own when nothing is up.
    if is_gateway_serving(port).await {
        *state.port.lock().map_err(|e| e.to_string())? = port;
        return Ok(GatewayStatus { running: true, port, pid: None });
    }

    // Nothing is serving — (re)start our own managed child. We only ever kill
    // our OWN previously-spawned child here, never a foreign process.
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        let _ = old.kill().await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    // Native mode always binds to loopback for security — never expose to LAN
    let bind = "loopback".to_string();
    let base_dir = paths::desktop_dir();
    let config_path = paths::config_path();

    // Ensure config exists with token auth
    let _token = ensure_config_with_token(&config_path, port, &bind)?;

    // Ensure paired devices have full operator scopes so internal callGateway()
    // (used by sessions_spawn / subagents / cron) doesn't hit "pairing required"
    // scope-upgrade errors. Scope upgrades are never silently auto-approved by
    // the gateway, so we patch the persisted pairing state at startup.
    ensure_paired_devices_full_scopes(&base_dir);

    // Pre-create the default workspace directory so the first message isn't delayed
    let default_workspace = paths::default_workspace_dir();
    if !default_workspace.exists() {
        let _ = std::fs::create_dir_all(&default_workspace);
    }

    // Find openclaw on PATH (same approach as openclaw-desktop)
    let openclaw = resolve_openclaw_binary().ok_or_else(|| {
        "OpenClaw not found. Run: npm install -g openclaw".to_string()
    })?;

    let gw_path = augmented_path();
    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args(["gateway", "run", "--bind", &bind, "--port", &port.to_string()])
        .env("PATH", &gw_path)
        .env("OPENCLAW_STATE_DIR", base_dir.to_str().unwrap())
        .env("OPENCLAW_CONFIG_PATH", config_path.to_str().unwrap())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    // Hide the console window on Windows
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start gateway: {}", e))?;

    // Take stdout/stderr before moving child into state, and stream them as events
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    fn spawn_log_reader(app: AppHandle, reader: impl tokio::io::AsyncRead + Unpin + Send + 'static) {
        use tokio::io::{AsyncBufReadExt, BufReader};
        tokio::spawn(async move {
            let mut lines = BufReader::new(reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app.emit("gateway-log", &line);
            }
        });
    }

    if let Some(out) = stdout {
        spawn_log_reader(app.clone(), out);
    }
    if let Some(err) = stderr {
        spawn_log_reader(app.clone(), err);
    }

    // Emit initial status
    let _ = app.emit("gateway-log", "Gateway process started, waiting for ready...");

    // Wait briefly and check if the process crashed on startup
    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    match child.try_wait() {
        Ok(Some(status)) => {
            let msg = format!("Gateway exited immediately with {}", status);
            let _ = app.emit("gateway-log", &msg);
            return Err(msg);
        }
        Ok(None) => { /* still running — good */ }
        Err(e) => return Err(format!("Failed to check gateway status: {}", e)),
    }

    let pid = child.id();
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        *child_lock = Some(child);
    }
    *state.port.lock().map_err(|e| e.to_string())? = port;

    Ok(GatewayStatus {
        running: true,
        port,
        pid,
    })
}

#[tauri::command]
pub async fn stop_gateway(state: State<'_, GatewayProcess>) -> Result<String, String> {
    let child = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        child_lock.take()
    };

    if let Some(mut child) = child {
        child.kill().await.map_err(|e| format!("Failed to kill gateway: {}", e))?;
        Ok("Gateway stopped".into())
    } else {
        Err("Gateway is not running".into())
    }
}

#[tauri::command]
pub async fn gateway_status(state: State<'_, GatewayProcess>) -> Result<GatewayStatus, String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;

    // 1. Our own managed child takes priority. Scope the lock so it is dropped
    //    before any `.await` below (std Mutex guards are not Send across await).
    {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    // Process exited — clear it and fall through to external probe.
                    *child_lock = None;
                }
                Ok(None) => {
                    return Ok(GatewayStatus { running: true, port, pid: child.id() });
                }
                Err(e) => return Err(format!("Failed to check gateway status: {}", e)),
            }
        }
    }

    // 2. No managed child: detect the user's local gateway on the standard port
    //    so the frontend connects to it instead of trying to start its own.
    if is_gateway_serving(18789).await {
        return Ok(GatewayStatus { running: true, port: 18789, pid: None });
    }

    Ok(GatewayStatus { running: false, port, pid: None })
}

/// Check if ANY gateway is listening on the given port (not just Tauri-managed).
/// Probes via HTTP from Rust side — no CORS issues.
#[tauri::command]
pub async fn probe_gateway_port(port: Option<u16>) -> Result<bool, String> {
    Ok(is_gateway_serving(port.unwrap_or(18789)).await)
}

/// Run `openclaw doctor` and return the output
#[tauri::command]
pub async fn run_doctor() -> Result<String, String> {
    let openclaw = resolve_openclaw_binary().ok_or_else(|| {
        "OpenClaw not found. Run: npm install -g openclaw".to_string()
    })?;
    let base_dir = paths::desktop_dir();
    let config_path = paths::config_path();

    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.arg("doctor")
        .env("OPENCLAW_STATE_DIR", base_dir.to_str().unwrap())
        .env("OPENCLAW_CONFIG_PATH", config_path.to_str().unwrap());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to run doctor: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    let mut result = stdout;
    if !stderr.is_empty() {
        if !result.is_empty() {
            result.push('\n');
        }
        result.push_str(&stderr);
    }

    if result.trim().is_empty() {
        result = if output.status.success() {
            "Doctor check passed with no output.".into()
        } else {
            format!("Doctor exited with code: {}", output.status)
        };
    }

    Ok(result)
}
