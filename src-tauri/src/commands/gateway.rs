use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode, GatewayRuntimeState};
use crate::state::GatewayProcess;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::net::TcpStream;

fn write_json_atomic(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    crate::commands::config::atomic_write_text(path, &raw)
}

fn write_openclaw_config_safely(
    path: &std::path::Path,
    value: &serde_json::Value,
) -> Result<(), String> {
    crate::commands::config::write_openclaw_config_value(path, value)
}

#[derive(Debug, Serialize)]
pub struct GatewayStatus {
    pub running: bool,
    pub port: u16,
    pub pid: Option<u32>,
    /// The gateway auth token. Present when `running` is true so the frontend
    /// can use it directly without a second round-trip to read the config file.
    pub token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GatewayObservation {
    ManagedChildReady,
    ManagedChildUnready,
    ManagedChildExited,
    EndpointHealthy,
    EndpointOffline,
}

fn runtime_after_observation(
    current: GatewayRuntimeState,
    observation: GatewayObservation,
) -> GatewayRuntimeState {
    let (lifecycle, mode) = match observation {
        GatewayObservation::ManagedChildReady => {
            (GatewayLifecycle::Running, GatewayRuntimeMode::ManagedChild)
        }
        GatewayObservation::ManagedChildUnready => {
            (GatewayLifecycle::Starting, GatewayRuntimeMode::ManagedChild)
        }
        GatewayObservation::ManagedChildExited | GatewayObservation::EndpointOffline => {
            (GatewayLifecycle::Stopped, GatewayRuntimeMode::None)
        }
        GatewayObservation::EndpointHealthy => {
            let mode = match current.mode {
                GatewayRuntimeMode::External
                | GatewayRuntimeMode::SystemService
                | GatewayRuntimeMode::Docker => current.mode,
                GatewayRuntimeMode::None | GatewayRuntimeMode::ManagedChild => {
                    GatewayRuntimeMode::External
                }
            };
            (GatewayLifecycle::Running, mode)
        }
    };
    GatewayRuntimeState {
        lifecycle,
        mode,
        restarting: current.restarting,
    }
}

fn reconcile_runtime_observation(
    state: &GatewayProcess,
    observation: GatewayObservation,
    reason: &str,
) -> Result<(), String> {
    let current = state.runtime_snapshot()?;
    let next = runtime_after_observation(current, observation);
    if next != current {
        state.transition(Some(next.lifecycle), Some(next.mode), None, reason);
    }
    Ok(())
}

#[cfg(test)]
mod runtime_observation_tests {
    use super::*;

    fn runtime(lifecycle: GatewayLifecycle, mode: GatewayRuntimeMode) -> GatewayRuntimeState {
        GatewayRuntimeState {
            lifecycle,
            mode,
            restarting: false,
        }
    }

    #[test]
    fn bug_gsc08_unready_managed_child_cannot_remain_running() {
        let current = runtime(GatewayLifecycle::Running, GatewayRuntimeMode::ManagedChild);
        assert_eq!(
            runtime_after_observation(current, GatewayObservation::ManagedChildUnready),
            runtime(GatewayLifecycle::Starting, GatewayRuntimeMode::ManagedChild)
        );
    }

    #[test]
    fn bug_gsc08_offline_endpoint_clears_stale_runtime_owner() {
        for mode in [
            GatewayRuntimeMode::External,
            GatewayRuntimeMode::SystemService,
            GatewayRuntimeMode::Docker,
        ] {
            let current = runtime(GatewayLifecycle::Running, mode);
            assert_eq!(
                runtime_after_observation(current, GatewayObservation::EndpointOffline),
                runtime(GatewayLifecycle::Stopped, GatewayRuntimeMode::None)
            );
        }
    }

    #[test]
    fn bug_gsc08_unowned_healthy_endpoint_is_external() {
        let stale = runtime(GatewayLifecycle::Running, GatewayRuntimeMode::ManagedChild);
        assert_eq!(
            runtime_after_observation(stale, GatewayObservation::EndpointHealthy),
            runtime(GatewayLifecycle::Running, GatewayRuntimeMode::External)
        );
    }

    #[test]
    fn bug_gsc08_observation_preserves_restart_ownership() {
        let current = GatewayRuntimeState {
            lifecycle: GatewayLifecycle::Reconnecting,
            mode: GatewayRuntimeMode::SystemService,
            restarting: true,
        };
        assert!(runtime_after_observation(current, GatewayObservation::EndpointHealthy).restarting);
    }
}

#[cfg(test)]
mod gateway_config_tests {
    use super::*;

    fn isolated_config_path(name: &str) -> std::path::PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir()
            .join(format!(
                "junqi-gateway-config-test-{}-{}-{}",
                name,
                std::process::id(),
                suffix
            ))
            .join("openclaw.json")
    }

    #[test]
    fn invalid_configured_port_uses_the_shared_default() {
        let path = isolated_config_path("invalid-port");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"gateway":{"port":70000}}"#).unwrap();

        assert_eq!(
            ConfigMetadata::load(&path).port,
            crate::commands::config::default_gateway_port()
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn explicit_non_token_auth_mode_is_preserved_and_rejected() {
        let path = isolated_config_path("password-mode");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original =
            r#"{"gateway":{"auth":{"mode":"password","password":"legacy","token":"existing"}}}"#;
        std::fs::write(&path, original).unwrap();

        let error = ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap_err();

        assert!(error.contains("password"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn inferred_token_auth_mode_is_not_materialized() {
        let path = isolated_config_path("inferred-token-mode");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"gateway":{"auth":{"token":"existing"}}}"#).unwrap();

        let token = ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(token, "existing");
        assert!(config["gateway"]["auth"].get("mode").is_none());
        assert_eq!(config["gateway"]["auth"]["token"], "existing");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn inferred_password_auth_is_not_rewritten_as_token_auth() {
        let path = isolated_config_path("inferred-password-mode");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = r#"{"gateway":{"auth":{"password":"existing"}}}"#;
        std::fs::write(&path, original).unwrap();

        let error = ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap_err();

        assert!(error.contains("password"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn blank_token_is_replaced_with_a_secure_token() {
        let path = isolated_config_path("blank-token");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"gateway":{"auth":{"token":"   "}}}"#).unwrap();

        let token = ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap();
        let config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

        assert_eq!(token.len(), 64);
        assert!(token.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(config["gateway"]["auth"]["token"], token);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_requested_port_does_not_create_or_mutate_config() {
        let path = isolated_config_path("invalid-requested-port");

        let error = ensure_config_with_token(&path, 0, "loopback").unwrap_err();

        assert!(error.contains("port"));
        assert!(!path.exists());
    }
}

/// Build a PATH that includes bundled Node.js, our openclaw prefix,
/// and common native install locations — same approach as openclaw-desktop.
fn augmented_path() -> String {
    crate::commands::system::openclaw_search_path()
}

/// Resolve `openclaw` on the augmented PATH — same as desktop's resolveOpenclawBinary.
pub fn resolve_openclaw_binary() -> Option<std::path::PathBuf> {
    crate::commands::system::resolve_openclaw_binary()
}

/// Lightweight snapshot of the fields we need from openclaw.json at gateway startup.
/// Parsed once per launch to avoid redundant disk reads across callers.
struct ConfigMetadata {
    /// Configured gateway port; uses the shared runtime default when absent.
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
            .and_then(crate::commands::config::gateway_port_from_config)
            .unwrap_or_else(crate::commands::config::default_gateway_port);

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

/// Resolve the user-configured Gateway port for commands that need to target
/// the Control UI without assuming OpenClaw's default port.
pub(crate) fn configured_gateway_port() -> u16 {
    ConfigMetadata::load(&paths::config_path()).port
}

/// Read the gateway auth token from the config file.
/// Returns `None` if the file is missing, malformed, or has no token.
fn read_gateway_token(config_path: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .filter(|token| !token.trim().is_empty())
        .map(|s| s.to_string())
}

/// Generate a 256-bit token from the operating system CSPRNG.
pub(crate) fn generate_token() -> Result<String, String> {
    use rand::{rngs::OsRng, RngCore};

    let mut bytes = [0_u8; 32];
    OsRng
        .try_fill_bytes(&mut bytes)
        .map_err(|error| format!("Failed to generate a secure Gateway token: {error}"))?;
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        use std::fmt::Write;
        write!(&mut token, "{byte:02x}")
            .map_err(|error| format!("Failed to encode the Gateway token: {error}"))?;
    }
    Ok(token)
}

pub(crate) fn ensure_config_with_token(
    config_path: &std::path::Path,
    port: u16,
    bind: &str,
) -> Result<String, String> {
    if port == 0 {
        return Err("Gateway port must be between 1 and 65535".into());
    }
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

    // 默认工作区落在 JunQi 管理目录下，避免首次启动时依赖用户 shell 环境。
    let default_workspace = paths::default_workspace_dir();
    let default_workspace_str = default_workspace.to_string_lossy().to_string();

    if config_path.exists() {
        // Read existing config and extract token
        let raw = std::fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("Failed to parse config: {}", e))?;

        let auth_config = config
            .get("gateway")
            .and_then(|gateway| gateway.get("auth"));
        let configured_auth_mode = auth_config.and_then(|auth| auth.get("mode"));
        if let Some(mode_value) = configured_auth_mode {
            let mode = mode_value
                .as_str()
                .ok_or("gateway.auth.mode must be a string")?;
            if mode != "token" {
                return Err(format!(
                    "Gateway auth mode `{}` is not compatible with JunQi token authentication; update the Gateway connection configuration first",
                    mode
                ));
            }
        } else if auth_config
            .and_then(|auth| auth.get("password"))
            .and_then(|password| password.as_str())
            .is_some_and(|password| !password.is_empty())
        {
            return Err(
                "Gateway password authentication is configured without an explicit auth mode; select a Gateway authentication mode before JunQi adds a token"
                    .into(),
            );
        }

        // Try to get existing token
        if let Some(token) = config
            .get("gateway")
            .and_then(|g| g.get("auth"))
            .and_then(|a| a.get("token"))
            .and_then(|t| t.as_str())
            .filter(|token| !token.trim().is_empty())
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

            write_openclaw_config_safely(config_path, &config)?;

            return Ok(token);
        }

        // Config exists but no token — add token auth
        let mut config = config;
        let gateway = config
            .as_object_mut()
            .ok_or("Config is not an object")?
            .entry("gateway")
            .or_insert_with(|| serde_json::json!({}));
        let gw_obj = gateway.as_object_mut().ok_or("gateway is not an object")?;

        // Ensure gateway.mode is set
        gw_obj
            .entry("mode")
            .or_insert_with(|| serde_json::json!("local"));

        // Always update bind and port to match the requested values
        gw_obj.insert("bind".into(), serde_json::json!(bind));
        gw_obj.insert("port".into(), serde_json::json!(port));

        // Ensure controlUi config
        gw_obj.insert("controlUi".into(), control_ui.clone());

        let auth = gw_obj
            .entry("auth")
            .or_insert_with(|| serde_json::json!({}));
        let auth_obj = auth.as_object_mut().ok_or("auth is not an object")?;
        let token = generate_token()?;
        auth_obj.insert("token".into(), serde_json::json!(token));

        write_openclaw_config_safely(config_path, &config)?;

        return Ok(token);
    }

    // Config doesn't exist — create with token
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }

    let token = generate_token()?;
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
                "token": token
            },
            "controlUi": control_ui
        }
    });
    write_openclaw_config_safely(config_path, &default_config)?;

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
                    if let Some(tokens) =
                        entry_obj.get_mut("tokens").and_then(|t| t.as_object_mut())
                    {
                        if let Some(op_token) =
                            tokens.get_mut("operator").and_then(|t| t.as_object_mut())
                        {
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
        let _ = crate::commands::config::atomic_write_text(&pending_path, "{}");
        let _ = write_json_atomic(&paired_path, &doc);
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
    let config: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse config: {}", e))?;

    config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "No gateway token found in config".into())
}

/// Returns true if a local listener accepts TCP connections on the gateway port.
///
/// This must stay quiet. A previous implementation used a WebSocket upgrade as
/// a health probe, but Gateway logs every incomplete WS handshake as
/// "closed before connect". Startup calls this from several paths, so the
/// upgrade probe could flood Gateway logs even though the app was only checking
/// liveness. The real protocol handshake is owned by the frontend connection.
pub async fn is_gateway_serving(port: u16) -> bool {
    tokio::time::timeout(
        std::time::Duration::from_millis(700),
        TcpStream::connect((crate::commands::config::default_gateway_host(), port)),
    )
    .await
    .map(|result| result.is_ok())
    .unwrap_or(false)
}

fn emit_restart_progress(app: &AppHandle, line: impl AsRef<str>) {
    let line = line.as_ref().to_string();
    let _ = app.emit("gateway-restart-progress", &line);
    let _ = app.emit("gateway-log", &line);
}

async fn wait_for_gateway_reachable(port: u16, timeout_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if is_gateway_serving(port).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    false
}

async fn start_managed_gateway_fallback(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    port: u16,
    reason: impl AsRef<str>,
) -> Result<GatewayStatus, String> {
    let reason = reason.as_ref();
    emit_restart_progress(
        &app,
        format!(
            "Gateway service restart unavailable ({}); starting desktop-managed Gateway...",
            reason
        ),
    );
    crate::state::gateway_process::push_log(
        &state.logs,
        crate::state::gateway_process::LogSource::Lifecycle,
        crate::state::gateway_process::LogLevel::Warn,
        format!("service restart fallback: {}", reason),
    );

    let status = match start_gateway_locked(app.clone(), state, Some(port)).await {
        Ok(status) => status,
        Err(error) => {
            app.state::<GatewayProcess>().transition(
                Some(GatewayLifecycle::Error),
                None,
                None,
                "restart fallback: managed Gateway failed",
            );
            return Err(format!(
                "{}; managed Gateway fallback failed: {}",
                reason, error
            ));
        }
    };
    emit_restart_progress(
        &app,
        "Waiting for desktop-managed Gateway to become reachable...",
    );
    if wait_for_gateway_reachable(port, 45).await {
        emit_restart_progress(&app, "Desktop-managed Gateway health check passed.");
        return Ok(status);
    }

    app.state::<GatewayProcess>().transition(
        Some(GatewayLifecycle::Error),
        None,
        None,
        "restart fallback: health check timed out",
    );
    Err(format!(
        "{}; desktop-managed Gateway did not become reachable on port {}",
        reason, port
    ))
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
    use std::sync::atomic::Ordering;

    let observed_restart_generation = state.restart_completed_generation.load(Ordering::Acquire);
    let operation_gate = state.operation_gate.clone();
    let _global_operation_guard = match operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            let _ = app.emit(
                "gateway-log",
                "Gateway lifecycle operation in progress; waiting for ownership...",
            );
            operation_gate.lock_owned().await
        }
    };
    if state.restart_completed_generation.load(Ordering::Acquire) != observed_restart_generation {
        let _ = app.emit(
            "gateway-log",
            "Concurrent Gateway restart finished; reusing its final status.",
        );
        return gateway_status(state).await;
    }
    *state.port.lock().map_err(|e| e.to_string())? = port;

    struct RestartCompletionGuard<'a> {
        generation: &'a std::sync::atomic::AtomicU64,
    }
    impl Drop for RestartCompletionGuard<'_> {
        fn drop(&mut self) {
            self.generation.fetch_add(1, Ordering::AcqRel);
        }
    }
    let _restart_completion_guard = RestartCompletionGuard {
        generation: &state.restart_completed_generation,
    };

    state.transition(
        Some(GatewayLifecycle::Reconnecting),
        None,
        Some(true),
        "restart_gateway: restarting system service",
    );
    // Guard: clear the flag no matter how we exit (success, error, panic).
    struct RestartGuard<'a> {
        state: &'a GatewayProcess,
    }
    impl<'a> Drop for RestartGuard<'a> {
        fn drop(&mut self) {
            self.state.transition(
                None,
                None,
                Some(false),
                "restart_gateway: restart operation completed",
            );
        }
    }
    let _restart_guard = RestartGuard { state: &state };

    emit_restart_progress(
        &app,
        format!("Restarting OpenClaw Gateway service on port {}...", port),
    );

    // Stop any foreground gateway spawned by this desktop app first. This does
    // not affect a user-managed LaunchAgent/systemd/schtasks service.
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        emit_restart_progress(&app, "Stopping desktop-managed gateway process...");
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut old).await;
        if let Err(error) =
            crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
        {
            emit_restart_progress(
                &app,
                format!("Gateway port release is still pending: {}", error),
            );
        }
    }

    let openclaw = resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw not found. Run: npm install -g openclaw".to_string())?;
    let gw_path = augmented_path();

    // Restart the installed Gateway service (launchd/systemd/schtasks). This is
    // the real local OpenClaw restart path; unlike start_gateway(), it does not
    // simply return success when an external listener is already serving.
    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args(["gateway", "--port", &port.to_string(), "restart"])
        .env("PATH", &gw_path)
        .env("OPENCLAW_STATE_DIR", paths::desktop_dir())
        .env("OPENCLAW_CONFIG_PATH", &config_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let reason = format!("Failed to restart gateway service: {}", error);
            drop(_restart_guard);
            return start_managed_gateway_fallback(app, state.clone(), port, reason).await;
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        spawn_restart_log_reader(
            app.clone(),
            out,
            crate::state::gateway_process::LogSource::ChildStdout,
        );
    }
    if let Some(err) = stderr {
        spawn_restart_log_reader(
            app.clone(),
            err,
            crate::state::gateway_process::LogSource::ChildStderr,
        );
    }

    let status = match tokio::time::timeout(std::time::Duration::from_secs(45), child.wait()).await
    {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            let reason = format!("Failed waiting for gateway restart: {}", error);
            crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
            drop(_restart_guard);
            return start_managed_gateway_fallback(app, state.clone(), port, reason).await;
        }
        Err(_) => {
            let reason = "Timed out while restarting gateway service".to_string();
            crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
            drop(_restart_guard);
            return start_managed_gateway_fallback(app, state.clone(), port, reason).await;
        }
    };
    if !status.success() {
        let msg = format!("openclaw gateway restart exited with {}", status);
        emit_restart_progress(&app, &msg);
        drop(_restart_guard);
        return start_managed_gateway_fallback(app, state.clone(), port, msg).await;
    }

    emit_restart_progress(
        &app,
        "Gateway service restart command completed; waiting for health check...",
    );

    emit_restart_progress(&app, "Waiting for Gateway to become reachable...");
    if wait_for_gateway_reachable(port, 45).await {
        let token = read_gateway_token(&config_path);
        emit_restart_progress(&app, "Gateway health check passed.");
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(GatewayRuntimeMode::SystemService),
            None,
            "restart_gateway: service health check passed",
        );
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token,
        });
    }

    let reason = "Gateway service restart completed but health check did not pass in time";
    drop(_restart_guard);
    start_managed_gateway_fallback(app, state.clone(), port, reason).await
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
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    start_gateway_locked(app, state, port).await
}

/// Start implementation for callers that already own `operation_gate`.
pub(crate) async fn start_gateway_locked(
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
    if state.runtime_snapshot()?.restarting {
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token: None,
        });
    }

    // If a gateway is already serving on JunQi's configured port, connect to it.
    // Do not probe unrelated desktop ports; those may belong to another app.
    if is_gateway_serving(port).await {
        *state.port.lock().map_err(|e| e.to_string())? = port;
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(GatewayRuntimeMode::External),
            None,
            "start_gateway: existing endpoint is healthy",
        );
        // Gateway already running — read the token from config so the frontend
        // can connect without an extra round-trip.
        let existing_token = read_gateway_token(&config_path);
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token: existing_token,
        });
    }

    // Nothing is serving — (re)start our own managed child. We only ever kill
    // our OWN previously-spawned child here, never a foreign process.
    state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Starting),
        None,
        None,
        "start_gateway: beginning spawn sequence",
    );
    struct StartFailureGuard<'a> {
        state: &'a GatewayProcess,
        armed: bool,
    }
    impl Drop for StartFailureGuard<'_> {
        fn drop(&mut self) {
            if self.armed {
                self.state.transition(
                    Some(GatewayLifecycle::Error),
                    None,
                    None,
                    "start_gateway: spawn sequence failed",
                );
            }
        }
    }
    let mut start_failure_guard = StartFailureGuard {
        state: &state,
        armed: true,
    };
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut old).await;
        // Handles TCP TIME_WAIT on Windows and delayed process teardown.
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
    let openclaw = resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw not found. Run: npm install -g openclaw".to_string())?;

    let gw_path = augmented_path();

    // Inject env.vars into the gateway process so providers that rely on
    // process-level environment variables (e.g. OPENAI_API_KEY) receive them
    // even when configured via the UI rather than the user's shell profile.
    // ConfigMetadata already parsed env.vars above — no additional disk IO here.
    let extra_env_vars = meta.env_vars;

    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args([
        "gateway",
        "run",
        "--bind",
        &bind,
        "--port",
        &port.to_string(),
    ])
    .env("PATH", &gw_path)
    .env("OPENCLAW_STATE_DIR", &base_dir)
    .env("OPENCLAW_CONFIG_PATH", &config_path);
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
    let _ = app.emit(
        "gateway-log",
        "Gateway process started, waiting for ready...",
    );
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
    state.transition(
        Some(GatewayLifecycle::Running),
        Some(GatewayRuntimeMode::ManagedChild),
        None,
        "start_gateway: child spawned",
    );
    start_failure_guard.armed = false;

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
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let child = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        child_lock.take()
    };

    if let Some(mut child) = child {
        child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill gateway: {}", e))?;
        state.transition(
            Some(GatewayLifecycle::Stopped),
            Some(GatewayRuntimeMode::None),
            None,
            "stop_gateway: managed child stopped",
        );
        Ok("Gateway stopped".into())
    } else {
        state.transition(
            Some(GatewayLifecycle::Stopped),
            Some(GatewayRuntimeMode::None),
            None,
            "stop_gateway: no managed child",
        );
        Ok("Gateway not running — nothing to stop".into())
    }
}

#[tauri::command]
pub async fn gateway_status(state: State<'_, GatewayProcess>) -> Result<GatewayStatus, String> {
    let config_path = paths::config_path();
    let configured_port = ConfigMetadata::load(&config_path).port;
    let state_port = *state.port.lock().map_err(|e| e.to_string())?;
    let port = if configured_port > 0 {
        configured_port
    } else {
        state_port
    };

    // If a real restart is in progress, report running=true so the frontend
    // status poller does NOT see a down→up flap and trigger a competing
    // start_gateway. The restart command owns the lifecycle right now.
    if state.runtime_snapshot()?.restarting {
        let token = read_gateway_token(&config_path);
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token,
        });
    }

    // Observation may reconcile canonical state only when no lifecycle owner
    // is active. A busy query remains read-only and cannot overwrite STARTING
    // or RECONNECTING while another command owns the operation gate.
    let _observation_guard = state.operation_gate.clone().try_lock_owned().ok();
    let can_reconcile = _observation_guard.is_some();

    // 1. Our own managed child takes priority. Compute the "still alive" flag
    //    and PID first (synchronously), then drop the lock, then await the
    //    gateway probe — std Mutex guards are not Send across await.
    let (child_alive, child_pid, child_exited) = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    if can_reconcile {
                        *child_lock = None;
                    }
                    (false, None, true)
                }
                Ok(None) => {
                    // Process is still running — keep the lock here and capture
                    // the PID. The lock is dropped at the end of this block.
                    (true, child.id(), false)
                }
                Err(e) => return Err(format!("Failed to check gateway status: {}", e)),
            }
        } else {
            (false, None, false)
        }
    };
    if child_exited && can_reconcile {
        reconcile_runtime_observation(
            &state,
            GatewayObservation::ManagedChildExited,
            "gateway_status: managed child exited",
        )?;
    }
    if child_alive {
        // Probe the local gateway port so `running` reflects "ready to serve",
        // not just "process is alive". Returning false here
        // causes the UI to keep waiting — BootTimelineOverlay will retry.
        if is_gateway_serving(port).await {
            if can_reconcile {
                reconcile_runtime_observation(
                    &state,
                    GatewayObservation::ManagedChildReady,
                    "gateway_status: managed child is healthy",
                )?;
            }
            let status_token = read_gateway_token(&config_path);
            return Ok(GatewayStatus {
                running: true,
                port,
                pid: child_pid,
                token: status_token,
            });
        }
        if can_reconcile {
            reconcile_runtime_observation(
                &state,
                GatewayObservation::ManagedChildUnready,
                "gateway_status: managed child endpoint is unavailable",
            )?;
        }
        return Ok(GatewayStatus {
            running: false,
            port,
            pid: child_pid,
            token: None,
        });
    }

    // 2. No managed child: probe JunQi's configured OpenClaw port only.
    if is_gateway_serving(port).await {
        if can_reconcile {
            *state.port.lock().map_err(|e| e.to_string())? = port;
            reconcile_runtime_observation(
                &state,
                GatewayObservation::EndpointHealthy,
                "gateway_status: configured endpoint is healthy",
            )?;
        }
        let probe_token = read_gateway_token(&config_path);
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token: probe_token,
        });
    }

    if can_reconcile {
        reconcile_runtime_observation(
            &state,
            GatewayObservation::EndpointOffline,
            "gateway_status: configured endpoint is offline",
        )?;
    }

    Ok(GatewayStatus {
        running: false,
        port,
        pid: None,
        token: None,
    })
}

/// Check if ANY gateway is listening on the given port (not just Tauri-managed).
/// Probes via HTTP from Rust side — no CORS issues.
#[tauri::command]
pub async fn probe_gateway_port(port: Option<u16>) -> Result<bool, String> {
    // When the caller supplies a port, probe it directly. Otherwise read
    // the configured port from openclaw.json so we detect gateways that
    // don't run on the shared default port.
    let target_port = match port {
        Some(p) => p,
        None => ConfigMetadata::load(&paths::config_path()).port,
    };
    Ok(is_gateway_serving(target_port).await)
}

/// Run `openclaw doctor` and return the output
#[tauri::command]
pub async fn run_doctor() -> Result<String, String> {
    let openclaw = resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw not found. Run: npm install -g openclaw".to_string())?;
    let base_dir = paths::desktop_dir();
    let config_path = paths::config_path();

    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.arg("doctor")
        .env("PATH", &augmented_path())
        .env("OPENCLAW_STATE_DIR", &base_dir)
        .env("OPENCLAW_CONFIG_PATH", &config_path);

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
