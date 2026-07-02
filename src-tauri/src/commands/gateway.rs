use std::sync::Mutex;
use crate::paths;
use crate::state::GatewayProcess;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Serialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    /// The gateway auth token. Present when `running` is true so the frontend
    /// can use it directly without a second round-trip to read the config file.
    pub token: Option<String>,
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
        // Native npm installs (Unix)
        parts.push(home.join(".npm-global").join("bin").to_string_lossy().to_string());
        parts.push(home.join(".local").join("bin").to_string_lossy().to_string());
        // asdf / mise version managers (shim node, npm, etc.)
        parts.push(home.join(".asdf").join("shims").to_string_lossy().to_string());
        // Windows: npm global bin lives under %APPDATA%\npm
        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("APPDATA") {
                parts.push(std::path::PathBuf::from(appdata).join("npm").to_string_lossy().to_string());
            }
            parts.push(home.join("AppData").join("Roaming").join("npm").to_string_lossy().to_string());
        }
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(if cfg!(windows) { ";" } else { ":" })
}

/// Resolve `openclaw` on the augmented PATH — same as desktop's resolveOpenclawBinary.
pub fn resolve_openclaw_binary() -> Option<std::path::PathBuf> {
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

/// Lightweight snapshot of the fields we need from openclaw.json at gateway startup.
/// Parsed once per launch to avoid redundant disk reads across callers.
struct ConfigMetadata {
    /// Configured gateway port; defaults to 18789 when absent.
    port: u16,
    /// Provider API keys and env overrides from `env.vars`.
    env_vars: Vec<(String, String)>,
}

impl ConfigMetadata {
    /// Load from the config file at `path`. Infallible — missing or
    /// malformed fields fall back to safe defaults.
    fn load(path: &std::path::Path) -> Self {
        let parsed: Option<serde_json::Value> = std::fs::read_to_string(path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok());

        let port = parsed
            .as_ref()
            .and_then(|cfg| cfg.get("gateway")?.get("port")?.as_u64())
            .map(|v| v as u16)
            .unwrap_or(18789);

        let env_vars = parsed
            .as_ref()
            .and_then(|cfg| cfg.get("env")?.get("vars")?.as_object())
            .map(|vars| {
                vars.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        Self { port, env_vars }
    }
}

/// Read the gateway auth token from the config file.
/// Returns `None` if the file is missing, malformed, or has no token.
fn read_gateway_token(config_path: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?.get("auth")?.get("token")?.as_str().map(|s| s.to_string())
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
pub async fn is_gateway_serving(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{}/healthz", port);
    matches!(reqwest::get(&url).await, Ok(resp) if resp.status().is_success())
}


fn emit_restart_progress(app: &AppHandle, line: impl AsRef<str>) {
    let line = line.as_ref().to_string();
    let _ = app.emit("gateway-restart-progress", &line);
    let _ = app.emit("gateway-log", &line);
}

/// Stream process output line-by-line, emitting each line as `gateway-log`
/// and pushing to the in-memory ring buffer.
fn spawn_log_reader(
    app: AppHandle,
    reader: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    source: crate::state::gateway_process::LogSource,
) {
    use crate::state::gateway_process::{push_log, LogLevel};
    use tokio::io::{AsyncBufReadExt, BufReader};
    tokio::spawn(async move {
        let state = app.state::<crate::state::GatewayProcess>();
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("gateway-log", &line);
            push_log(&state.logs, source, LogLevel::Info, line);
        }
    });
}

/// Like `spawn_log_reader` but also emits to `gateway-restart-progress`
/// so the boot-recovery UI can track process output during restarts.
fn spawn_restart_log_reader(
    app: AppHandle,
    reader: impl tokio::io::AsyncRead + Unpin + Send + 'static,
    source: crate::state::gateway_process::LogSource,
) {
    use crate::state::gateway_process::{push_log, LogLevel};
    use tokio::io::{AsyncBufReadExt, BufReader};
    tokio::spawn(async move {
        let state = app.state::<crate::state::GatewayProcess>();
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app.emit("gateway-restart-progress", &line);
            let _ = app.emit("gateway-log", &line);
            push_log(&state.logs, source, LogLevel::Info, line);
        }
    });
}

#[tauri::command]
pub async fn restart_gateway(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    port: Option<u16>,
) -> Result<GatewayStatus, String> {
    let config_path = paths::config_path();
    let meta = ConfigMetadata::load(&config_path);
    let port = port.unwrap_or(meta.port);
    *state.port.lock().map_err(|e| e.to_string())? = port;

    // Mark restarting so the status poller / start_gateway don't race us:
    // gateway_status returns running=true, start_gateway refuses to spawn.
    *state.restarting.lock().map_err(|e| e.to_string())? = true;
    // Guard: clear the flag no matter how we exit (success, error, panic).
    struct RestartGuard<'a> { flag: &'a Mutex<bool> }
    impl<'a> Drop for RestartGuard<'a> {
        fn drop(&mut self) {
            if let Ok(mut g) = self.flag.lock() { *g = false; }
        }
    }
    let _restart_guard = RestartGuard { flag: &state.restarting };

    emit_restart_progress(&app, format!("Restarting OpenClaw Gateway service on port {}...", port));

    // Stop any foreground gateway spawned by this desktop app first. This does
    // not affect a user-managed LaunchAgent/systemd/schtasks service.
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        emit_restart_progress(&app, "Stopping desktop-managed gateway process...");
        let _ = old.kill().await;
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }

    let openclaw = resolve_openclaw_binary().ok_or_else(|| {
        "OpenClaw not found. Run: npm install -g openclaw".to_string()
    })?;
    let gw_path = augmented_path();

    // Restart the installed Gateway service (launchd/systemd/schtasks). This is
    // the real local OpenClaw restart path; unlike start_gateway(), it does not
    // simply return success when an external listener is already serving.
    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args(["gateway", "--port", &port.to_string(), "restart"])
        .env("PATH", &gw_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to restart gateway service: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout { spawn_restart_log_reader(app.clone(), out, crate::state::gateway_process::LogSource::ChildStdout); }
    if let Some(err) = stderr { spawn_restart_log_reader(app.clone(), err, crate::state::gateway_process::LogSource::ChildStderr); }

    let status = tokio::time::timeout(std::time::Duration::from_secs(45), child.wait())
        .await
        .map_err(|_| "Timed out while restarting gateway service".to_string())?
        .map_err(|e| format!("Failed waiting for gateway restart: {}", e))?;
    if !status.success() {
        let msg = format!("openclaw gateway restart exited with {}", status);
        emit_restart_progress(&app, &msg);
        return Err(msg);
    }

    emit_restart_progress(&app, "Gateway service restart command completed; waiting for health check...");

    emit_restart_progress(&app, "Waiting for Gateway to become reachable...");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(45);
    while std::time::Instant::now() < deadline {
        if is_gateway_serving(port).await {
            let token = read_gateway_token(&config_path);
            emit_restart_progress(&app, "Gateway health check passed.");
            return Ok(GatewayStatus { running: true, port, pid: None, token });
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }

    Err("Gateway restart completed but health check did not pass in time".to_string())
}

/// Front-end bridge (`aegis-adapter.ts → gateway.retry()`) invokes the command
/// named `restart_local_gateway`. Exposed as a thin alias so the existing
/// bridge keeps working without renaming JS-side code.
#[tauri::command]
pub async fn restart_local_gateway(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<GatewayStatus, String> {
    restart_gateway(app, state, None).await
}

#[tauri::command]
pub async fn start_gateway(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    port: Option<u16>,
) -> Result<GatewayStatus, String> {
    // Load config metadata once. This single read serves both port resolution
    // and env_vars injection, avoiding duplicate IO later in the function.
    let config_path = paths::config_path();
    let meta = ConfigMetadata::load(&config_path);
    // Caller-supplied port takes precedence; fall back to config, then default.
    let port = port.unwrap_or(meta.port);

    // A real `openclaw gateway restart` owns the lifecycle right now — do not
    // spawn a competing foreground child. Report the configured port so the
    // caller retries status instead of racing the restart.
    if *state.restarting.lock().map_err(|e| e.to_string())? {
        return Ok(GatewayStatus { running: true, port, pid: None, token: None });
    }

    // "Rely on local openclaw": if a gateway is already listening on this port
    // (the user's own `openclaw gateway`, hermes, etc.), connect to it — never
    // kill or restart an external process. Only start our own when nothing is up.
    if is_gateway_serving(port).await {
        *state.port.lock().map_err(|e| e.to_string())? = port;
        // Gateway already running — read the token from config so the frontend
        // can connect without an extra round-trip.
        let existing_token = read_gateway_token(&config_path);
        return Ok(GatewayStatus { running: true, port, pid: None, token: existing_token });
    }

    // Nothing is serving — (re)start our own managed child. We only ever kill
    // our OWN previously-spawned child here, never a foreign process.
    // Ported from ClawX: transition lifecycle → Starting before spawn.
    crate::commands::gateway_supervisor::transition_lifecycle(
        &state,
        crate::state::gateway_process::GatewayLifecycle::Starting,
        "start_gateway: beginning spawn sequence",
    );
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut old).await;
        // Ported from ClawX: wait for port to free after killing old child
        // (handles TCP TIME_WAIT on Windows, launchd respawn on macOS).
        let _ = crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await;
    }

    // Native mode always binds to loopback for security — never expose to LAN
    let bind = "loopback".to_string();
    let base_dir = paths::desktop_dir();
    // config_path already resolved above via ConfigMetadata::load.

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

    // Inject env.vars into the gateway process so providers that rely on
    // process-level environment variables (e.g. OPENAI_API_KEY) receive them
    // even when configured via the UI rather than the user's shell profile.
    // ConfigMetadata already parsed env.vars above — no additional disk IO here.
    let extra_env_vars = meta.env_vars;

    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args(["gateway", "run", "--bind", &bind, "--port", &port.to_string()])
        .env("PATH", &gw_path)
        .env("OPENCLAW_STATE_DIR", base_dir.to_str().unwrap())
        .env("OPENCLAW_CONFIG_PATH", config_path.to_str().unwrap());
    for (k, v) in &extra_env_vars {
        cmd.env(k, v);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    // Hide the console window on Windows
    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| {
        // Diagnose common failure modes. Pre-fix: just returned the raw
        // io::Error which was opaque to the user.
        if e.kind() == std::io::ErrorKind::NotFound {
            format!(
                "openclaw not found on PATH (current PATH={:?}). \
                 If openclaw is installed under ~/.npm-global/bin, \
                 run 'export PATH=$HOME/.npm-global/bin:$PATH' \
                 or set OPENCLAW_BIN env var. Underlying error: {}",
                std::env::var("PATH").unwrap_or_default(),
                e,
            )
        } else {
            format!("Failed to start gateway: {}", e)
        }
    })?;

    // Take stdout/stderr before moving child into state, and stream them as events
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        spawn_log_reader(
            app.clone(),
            out,
            crate::state::gateway_process::LogSource::ChildStdout,
        );
    }
    if let Some(err) = stderr {
        spawn_log_reader(
            app.clone(),
            err,
            crate::state::gateway_process::LogSource::ChildStderr,
        );
    }

    // Emit initial status
    let _ = app.emit("gateway-log", "Gateway process started, waiting for ready...");
    crate::state::gateway_process::push_log(
        &state.logs,
        crate::state::gateway_process::LogSource::Lifecycle,
        crate::state::gateway_process::LogLevel::Info,
        format!("start_gateway invoked (port={})", port),
    );

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
    // Ported from ClawX: transition lifecycle → Running once child is spawned.
    crate::commands::gateway_supervisor::transition_lifecycle(
        &state,
        crate::state::gateway_process::GatewayLifecycle::Running,
        "start_gateway: child spawned",
    );

    // Re-read the token that ensure_config_with_token just wrote/read
    // so we return it in a single IPC round-trip.
    let final_token = read_gateway_token(&config_path);
    Ok(GatewayStatus {
        running: true,
        port,
        pid,
        token: final_token,
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
        Ok("Gateway not running — nothing to stop".into())
    }
}

#[tauri::command]
pub async fn gateway_status(state: State<'_, GatewayProcess>) -> Result<GatewayStatus, String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;

    // If a real restart is in progress, report running=true so the frontend
    // status poller does NOT see a down→up flap and trigger a competing
    // start_gateway. The restart command owns the lifecycle right now.
    if *state.restarting.lock().map_err(|e| e.to_string())? {
        let token = read_gateway_token(&paths::config_path());
        return Ok(GatewayStatus { running: true, port, pid: None, token });
    }

    // 1. Our own managed child takes priority. Compute the "still alive" flag
    //    and PID first (synchronously), then drop the lock, then await the
    //    healthz probe — std Mutex guards are not Send across await.
    let (child_alive, child_pid) = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    // Process exited — clear it and fall through to external probe.
                    *child_lock = None;
                    (false, None)
                }
                Ok(None) => {
                    // Process is still running — keep the lock here and capture
                    // the PID. The lock is dropped at the end of this block.
                    (true, child.id())
                }
                Err(e) => return Err(format!("Failed to check gateway status: {}", e)),
            }
        } else {
            (false, None)
        }
    };
    if child_alive {
        // Probe the actual HTTP /healthz endpoint so `running` reflects
        // "ready to serve" not just "process is alive". Returning false here
        // causes the UI to keep waiting — BootTimelineOverlay will retry.
        if !is_gateway_serving(port).await {
            return Ok(GatewayStatus { running: false, port, pid: child_pid, token: None });
        }
        let status_token = read_gateway_token(&paths::config_path());
        return Ok(GatewayStatus { running: true, port, pid: child_pid, token: status_token });
    }

    // 2. No managed child: probe on the last-known port (set by start_gateway).
    //    Avoid a file read on this hot polling path. Only fall back to parsing
    //    the config when port is still 0 (never started by us in this session).
    let probe_port = if port == 0 {
        ConfigMetadata::load(&paths::config_path()).port
    } else {
        port
    };
    if is_gateway_serving(probe_port).await {
        let probe_token = read_gateway_token(&paths::config_path());
        return Ok(GatewayStatus { running: true, port: probe_port, pid: None, token: probe_token });
    }

    Ok(GatewayStatus { running: false, port, pid: None, token: None })
}

/// Check if ANY gateway is listening on the given port (not just Tauri-managed).
/// Probes via HTTP from Rust side — no CORS issues.
#[tauri::command]
pub async fn probe_gateway_port(port: Option<u16>) -> Result<bool, String> {
    // When the caller supplies a port, probe it directly. Otherwise read
    // the configured port from openclaw.json so we detect gateways that
    // don't run on the default 18789.
    let target_port = match port {
        Some(p) => p,
        None => ConfigMetadata::load(&paths::config_path()).port,
    };
    Ok(is_gateway_serving(target_port).await)
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
        .env("PATH", &augmented_path())
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
