use crate::commands::gateway::{ensure_config_with_token, GatewayStatus};
use crate::commands::setup_progress::{emit, emit_error};
use crate::paths;
use crate::platform;
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

const OPENCLAW_IMAGE: &str = "ghcr.io/openclaw/openclaw";
/// Stable container name owned exclusively by JunQi. Keep every Docker entry
/// point on this constant so terminal integration and CLI helpers cannot drift
/// from the lifecycle manager.
pub(crate) const OPENCLAW_CONTAINER_NAME: &str = "maxauto-openclaw";
pub(crate) const OPENCLAW_CONTAINER_STATE_DIR: &str = "/home/node/.openclaw";
pub(crate) const OPENCLAW_CONTAINER_CONFIG_PATH: &str = "/home/node/.openclaw/openclaw.json";

#[derive(Default)]
struct DockerPullProgress {
    layers: HashMap<String, f64>,
    furthest: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum DockerLayerPhase {
    Queued,
    Downloading(f64),
    Verifying,
    Downloaded,
    Extracting(f64),
    Complete,
}

impl DockerLayerPhase {
    fn fraction(self) -> f64 {
        match self {
            Self::Queued => 0.02,
            Self::Downloading(ratio) => 0.05 + ratio * 0.5,
            Self::Verifying => 0.58,
            Self::Downloaded => 0.62,
            Self::Extracting(ratio) => 0.62 + ratio * 0.36,
            Self::Complete => 1.0,
        }
    }
}

const FIXED_DOCKER_PHASES: &[(&str, DockerLayerPhase)] = &[
    ("Pull complete", DockerLayerPhase::Complete),
    ("Download complete", DockerLayerPhase::Downloaded),
    ("Verifying Checksum", DockerLayerPhase::Verifying),
    ("Pulling fs layer", DockerLayerPhase::Queued),
    ("Waiting", DockerLayerPhase::Queued),
];

#[derive(Clone, Copy)]
struct TransferPhaseRule {
    prefix: &'static str,
    build: fn(f64) -> DockerLayerPhase,
}

const TRANSFER_DOCKER_PHASES: &[TransferPhaseRule] = &[
    TransferPhaseRule {
        prefix: "Downloading",
        build: DockerLayerPhase::Downloading,
    },
    TransferPhaseRule {
        prefix: "Extracting",
        build: DockerLayerPhase::Extracting,
    },
];

fn parse_docker_layer_phase(state: &str) -> Option<DockerLayerPhase> {
    FIXED_DOCKER_PHASES
        .iter()
        .find_map(|(prefix, phase)| state.strip_prefix(prefix).map(|_| *phase))
        .or_else(|| {
            TRANSFER_DOCKER_PHASES.iter().find_map(|rule| {
                state.strip_prefix(rule.prefix)?;
                transfer_ratio(state).map(rule.build)
            })
        })
}

impl DockerPullProgress {
    fn observe(&mut self, line: &str) -> f64 {
        let Some((layer, state)) = line.trim().split_once(": ") else {
            return self.furthest;
        };
        let Some(phase) = parse_docker_layer_phase(state) else {
            return self.furthest;
        };
        let layer_progress = phase.fraction();
        self.layers
            .entry(layer.to_owned())
            .and_modify(|current| *current = current.max(layer_progress))
            .or_insert(layer_progress);
        let aggregate = self.layers.values().sum::<f64>() / self.layers.len() as f64;
        self.furthest = self.furthest.max(aggregate).clamp(0.0, 0.98);
        self.furthest
    }
}

fn transfer_ratio(state: &str) -> Option<f64> {
    let pair = state.split_whitespace().find(|part| part.contains('/'))?;
    let (current, total) = pair.split_once('/')?;
    let total = parse_transfer_size(total)?;
    if total <= 0.0 {
        return None;
    }
    Some((parse_transfer_size(current)? / total).clamp(0.0, 1.0))
}

fn parse_transfer_size(value: &str) -> Option<f64> {
    let split = value.find(|ch: char| !ch.is_ascii_digit() && ch != '.')?;
    let number = value[..split].parse::<f64>().ok()?;
    let unit = value[split..].trim().to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "b" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(number * multiplier)
}

async fn stream_docker_output<R>(
    reader: R,
    app: AppHandle,
    tracker: Arc<Mutex<DockerPullProgress>>,
    tail: Arc<Mutex<VecDeque<String>>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().trim_matches('\r');
        if line.is_empty() {
            continue;
        }
        let progress = tracker
            .lock()
            .map(|mut state| state.observe(line))
            .unwrap_or(0.0);
        if let Ok(mut entries) = tail.lock() {
            if entries.len() == 20 {
                entries.pop_front();
            }
            entries.push_back(line.to_owned());
        }
        emit(&app, "pull", line, progress);
    }
}

#[derive(Debug, Serialize)]
pub struct DockerStatus {
    pub available: bool,
    pub version: Option<String>,
    pub daemon_running: bool,
}

pub(crate) async fn resolve_docker_bin() -> Result<String, String> {
    let detected = platform::detect_path("docker");
    if !detected.is_empty()
        && tokio::process::Command::new(&detected)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    {
        return Ok(detected);
    }

    let configured = platform::bin_name("docker");
    if tokio::process::Command::new(&configured)
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Ok(configured);
    }

    let mut candidates: Vec<PathBuf> = vec![
        "/usr/local/bin/docker".into(),
        "/opt/homebrew/bin/docker".into(),
        "/usr/bin/docker".into(),
        "/bin/docker".into(),
    ];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".docker").join("bin").join("docker"));
    }

    #[cfg(windows)]
    {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("Docker")
                    .join("Docker")
                    .join("resources")
                    .join("bin")
                    .join("docker.exe"),
            );
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("Docker")
                    .join("Docker")
                    .join("resources")
                    .join("bin")
                    .join("docker.exe"),
            );
        }
    }

    for candidate in candidates {
        if candidate.exists()
            && tokio::process::Command::new(&candidate)
                .arg("--version")
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false)
        {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    if !cfg!(windows) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = tokio::process::Command::new(shell)
            .args(["-lc", "command -v docker"])
            .output()
            .await
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(path);
                }
            }
        }
    }

    Err("Docker CLI not found".to_string())
}

fn docker_gateway_configured_port() -> u16 {
    let path = paths::docker_config_path();
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| crate::commands::config::gateway_port_from_config(&config))
        .unwrap_or_else(crate::commands::config::default_gateway_port)
}

/// Release only the foreground Gateway child owned by this desktop process
/// before Docker binds the same local port. External services stay untouched.
pub(crate) async fn release_managed_native_gateway_for_docker(
    state: &crate::state::GatewayProcess,
    port: u16,
) -> Result<bool, String> {
    let native_child = {
        let mut child = state.child.lock().map_err(|error| error.to_string())?;
        child.take()
    };
    let Some(mut child) = native_child else {
        return Ok(false);
    };
    crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
    crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await?;
    Ok(true)
}

/// Stop JunQi's named Docker container before the selected Native runtime
/// reclaims its port. The container name is owned by JunQi, so this never
/// targets arbitrary user containers.
pub(crate) async fn release_managed_docker_gateway_for_native(port: u16) -> Result<bool, String> {
    if !docker_gateway_status(None).await?.running {
        return Ok(false);
    }
    stop_docker_gateway_locked().await?;
    crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await?;
    Ok(true)
}

/// Check if Docker CLI is installed and the daemon is running.
#[tauri::command]
pub async fn check_docker() -> Result<DockerStatus, String> {
    // Check if docker CLI exists
    let docker_bin = match resolve_docker_bin().await {
        Ok(bin) => bin,
        Err(_) => {
            return Ok(DockerStatus {
                available: false,
                version: None,
                daemon_running: false,
            });
        }
    };
    let version_output = tokio::process::Command::new(&docker_bin)
        .args(["version", "--format", "{{.Server.Version}}"])
        .output()
        .await;

    match version_output {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(DockerStatus {
                available: true,
                version: if version.is_empty() {
                    None
                } else {
                    Some(version)
                },
                daemon_running: true,
            })
        }
        Ok(_output) => {
            // Docker CLI exists but daemon might not be running
            // Try just `docker --version` to confirm CLI is there
            let cli_check = tokio::process::Command::new(&docker_bin)
                .args(["--version"])
                .output()
                .await;
            match cli_check {
                Ok(o) if o.status.success() => {
                    let raw = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // Extract version from "Docker version 24.0.7, build ..."
                    let version = raw
                        .strip_prefix("Docker version ")
                        .and_then(|s| s.split(',').next())
                        .map(|s| s.to_string());
                    Ok(DockerStatus {
                        available: true,
                        version,
                        daemon_running: false,
                    })
                }
                _ => Ok(DockerStatus {
                    available: false,
                    version: None,
                    daemon_running: false,
                }),
            }
        }
        Err(_) => Ok(DockerStatus {
            available: false,
            version: None,
            daemon_running: false,
        }),
    }
}

/// Pull the official OpenClaw Docker image.
#[tauri::command]
pub async fn pull_openclaw_image(app: AppHandle, tag: Option<String>) -> Result<String, String> {
    let tag = tag.unwrap_or_else(|| "latest".to_string());
    let image = format!("{}:{}", OPENCLAW_IMAGE, tag);

    emit(&app, "pull", &format!("Pulling {}...", image), 0.0);

    let docker_bin = resolve_docker_bin().await?;
    let mut command = tokio::process::Command::new(&docker_bin);
    command
        .args(["pull", &image])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        let message = format!("Failed to run docker pull: {}", error);
        emit_error(&app, "pull", &message, Some(0.0));
        message
    })?;
    let tracker = Arc::new(Mutex::new(DockerPullProgress::default()));
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let stdout_task = child.stdout.take().map(|stdout| {
        tokio::spawn(stream_docker_output(
            stdout,
            app.clone(),
            Arc::clone(&tracker),
            Arc::clone(&tail),
        ))
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        tokio::spawn(stream_docker_output(
            stderr,
            app.clone(),
            Arc::clone(&tracker),
            Arc::clone(&tail),
        ))
    });
    let status = match child.wait().await {
        Ok(status) => status,
        Err(error) => {
            let message = format!("docker pull process failed: {}", error);
            emit_error(&app, "pull", &message, None);
            return Err(message);
        }
    };
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    if !status.success() {
        let detail = tail
            .lock()
            .map(|entries| entries.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        let message = format!("docker pull failed: {}", detail);
        emit_error(&app, "pull", &message, None);
        return Err(message);
    }

    emit(&app, "pull", "Image pulled successfully", 1.0);
    Ok(format!("Pulled {}", image))
}

/// Start OpenClaw in a Docker container with bind-mounted config and workspace.
#[tauri::command]
pub async fn start_docker_gateway(
    app: AppHandle,
    state: State<'_, crate::state::GatewayProcess>,
    port: Option<u16>,
    tag: Option<String>,
) -> Result<GatewayStatus, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let target_port = port.unwrap_or_else(docker_gateway_configured_port);
    // A mode switch must release JunQi's own native child before Docker binds
    // the selected port. Do not touch an unknown external service here: a
    // subsequent `docker run` will surface a precise port-conflict error.
    release_managed_native_gateway_for_docker(&state, target_port).await?;
    state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Starting),
        None,
        None,
        "start_docker_gateway: starting container",
    );
    let result = start_docker_gateway_locked(app, Some(target_port), tag).await;
    match &result {
        Ok(_) => state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Running),
            Some(crate::state::gateway_process::GatewayRuntimeMode::Docker),
            None,
            "start_docker_gateway: container healthy",
        ),
        Err(_) => state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Error),
            Some(crate::state::gateway_process::GatewayRuntimeMode::None),
            None,
            "start_docker_gateway: container failed",
        ),
    }
    result
}

/// Docker start implementation for callers that already own `operation_gate`.
pub(crate) async fn start_docker_gateway_locked(
    app: AppHandle,
    port: Option<u16>,
    tag: Option<String>,
) -> Result<GatewayStatus, String> {
    let container_port = docker_gateway_configured_port();
    let port = port.unwrap_or(container_port);
    let tag = tag.unwrap_or_else(|| "latest".to_string());
    let image = format!("{}:{}", OPENCLAW_IMAGE, tag);
    // Docker mode is a self-contained alternative deployment: the whole `docker/`
    // directory is bind-mounted as the container's `~/.openclaw` home, and the
    // gateway inside binds to `lan` (0.0.0.0). This is intentionally SEPARATE from
    // native mode, which relies on the user's local openclaw config at
    // `paths::config_path()` (~/.openclaw/openclaw.json) with loopback bind.
    let config_path = paths::docker_config_path();
    let config_dir = config_path
        .parent()
        .ok_or("Invalid Docker configuration path")?
        .to_path_buf();

    // Ensure directories exist
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;

    // Ensure config with token (use "lan" bind since container needs 0.0.0.0)
    let token = ensure_config_with_token(&config_path, container_port, "lan")?;

    // Read workspace from config, with fallback to default
    let workspace_dir = paths::read_workspace_from_config(&config_path)
        .unwrap_or_else(paths::default_workspace_dir);
    std::fs::create_dir_all(&workspace_dir)
        .map_err(|e| format!("Failed to create workspace dir: {}", e))?;

    // Remove existing container if it exists (ignore errors)
    let docker_bin = resolve_docker_bin().await?;
    let _ = tokio::process::Command::new(&docker_bin)
        .args(["rm", "-f", OPENCLAW_CONTAINER_NAME])
        .output()
        .await;

    emit(&app, "container", "Starting Docker container...", 0.15);

    let config_mount = format!(
        "{}:{OPENCLAW_CONTAINER_STATE_DIR}",
        config_dir.to_str().ok_or("Invalid config dir path")?
    );
    let workspace_mount = format!(
        "{}:{OPENCLAW_CONTAINER_STATE_DIR}/workspace",
        workspace_dir.to_str().ok_or("Invalid workspace dir path")?
    );
    // Bind to the configured loopback host so the port is not exposed to the LAN.
    let port_mapping = format!(
        "{}:{}:{}",
        crate::commands::config::default_gateway_host(),
        port,
        container_port
    );
    let token_env = format!("OPENCLAW_GATEWAY_TOKEN={}", token);
    let state_dir_env = format!("OPENCLAW_STATE_DIR={OPENCLAW_CONTAINER_STATE_DIR}");
    let config_path_env = format!("OPENCLAW_CONFIG_PATH={OPENCLAW_CONTAINER_CONFIG_PATH}");

    let output = tokio::process::Command::new(&docker_bin)
        .args([
            "run",
            "-d",
            "--name",
            OPENCLAW_CONTAINER_NAME,
            "-p",
            &port_mapping,
            "-e",
            &token_env,
            "-e",
            "OPENCLAW_GATEWAY_BIND=lan",
            "-e",
            &state_dir_env,
            "-e",
            &config_path_env,
            "-v",
            &config_mount,
            "-v",
            &workspace_mount,
            "--restart",
            "unless-stopped",
            &image,
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to start Docker container: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = format!("docker run failed: {}", stderr);
        emit_error(&app, "container", &message, Some(0.2));
        return Err(message);
    }

    // Wait for the gateway to be ready (TCP connect check, up to 30s)
    // Use the same readiness contract as native mode: the mapped local port
    // must accept a TCP connection.
    emit(
        &app,
        "container",
        "Waiting for gateway to be ready...",
        0.55,
    );
    let addr = format!(
        "{}:{}",
        crate::commands::config::default_gateway_host(),
        port
    );
    let mut healthy = false;
    for attempt in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            healthy = true;
            break;
        }
        emit(
            &app,
            "container",
            &format!("Waiting for gateway health check ({}/30)...", attempt + 1),
            0.55 + (attempt as f64 / 30.0) * 0.4,
        );
    }

    if !healthy {
        // Check if container is still running
        let inspect = tokio::process::Command::new(&docker_bin)
            .args([
                "inspect",
                "--format",
                "{{.State.Running}}",
                OPENCLAW_CONTAINER_NAME,
            ])
            .output()
            .await;

        let container_running = inspect
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false);

        if !container_running {
            // Get container logs for debugging
            let logs = tokio::process::Command::new(&docker_bin)
                .args(["logs", "--tail", "20", OPENCLAW_CONTAINER_NAME])
                .output()
                .await;
            let log_text = logs
                .map(|o| {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    let stderr = String::from_utf8_lossy(&o.stderr);
                    format!("{}{}", stdout, stderr)
                })
                .unwrap_or_default();

            let message = format!("Container exited unexpectedly. Logs:\n{}", log_text);
            emit_error(&app, "container", &message, Some(0.95));
            return Err(message);
        }

        let message = "Gateway health check timed out after 30s";
        emit_error(&app, "container", message, Some(0.95));
        return Err(message.into());
    }

    emit(&app, "container", "Gateway is ready", 1.0);

    // SPEC M10: tail the container's log stream into the Rust-side circular
    // buffer so the Settings → Storage panel can show what just happened.
    // Detached from this command's lifetime — runs until the container exits
    // or the desktop process exits.
    spawn_docker_log_tailer(app.clone());

    Ok(GatewayStatus {
        running: true,
        port,
        pid: None, // Docker manages the PID
        token: Some(token),
    })
}

/// Spawn `docker logs -f --tail 50` for JunQi's managed container and pipe its lines into
/// the 200-entry circular buffer. Runs as a detached tokio task; logs are
/// tagged as `DockerStdout` / `DockerStderr` so the frontend can distinguish
/// them from native child logs.
fn spawn_docker_log_tailer(app: AppHandle) {
    use crate::state::gateway_process::{push_log, LogLevel, LogSource};
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    tokio::spawn(async move {
        let docker_bin = match resolve_docker_bin().await {
            Ok(bin) => bin,
            Err(e) => {
                eprintln!("docker log tailer resolve failed: {}", e);
                return;
            }
        };
        let mut cmd = Command::new(&docker_bin);
        cmd.args(["logs", "-f", "--tail", "50", OPENCLAW_CONTAINER_NAME])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("docker log tailer spawn failed: {}", e);
                return;
            }
        };

        let app_out = app.clone();
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app_out.emit("gateway-log", &line);
                    let state = app_out.state::<crate::state::GatewayProcess>();
                    push_log(&state.logs, LogSource::DockerStdout, LogLevel::Info, line);
                }
            });
        }
        let app_err = app.clone();
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app_err.emit("gateway-log", &line);
                    let state = app_err.state::<crate::state::GatewayProcess>();
                    push_log(&state.logs, LogSource::DockerStderr, LogLevel::Warn, line);
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        parse_docker_layer_phase, parse_transfer_size, transfer_ratio, DockerLayerPhase,
        DockerPullProgress,
    };

    #[test]
    fn parses_docker_transfer_sizes_and_ratios() {
        assert_eq!(parse_transfer_size("1kB"), Some(1024.0));
        assert_eq!(parse_transfer_size("2MB"), Some(2.0 * 1024.0 * 1024.0));
        assert_eq!(transfer_ratio("Downloading 1MB/2MB"), Some(0.5));
    }

    #[test]
    fn docker_layer_progress_is_monotonic() {
        let mut tracker = DockerPullProgress::default();
        let first = tracker.observe("abc123: Downloading 1MB/2MB");
        let second = tracker.observe("abc123: Extracting 1MB/2MB");
        let delayed_layer = tracker.observe("def456: Pulling fs layer");
        let complete = tracker.observe("abc123: Pull complete");
        assert!(second > first);
        assert!(delayed_layer >= second);
        assert!(complete >= delayed_layer);
        assert!(complete <= 0.98);
    }

    #[test]
    fn docker_output_maps_to_explicit_layer_phases() {
        assert_eq!(
            parse_docker_layer_phase("Downloading 1MB/2MB"),
            Some(DockerLayerPhase::Downloading(0.5))
        );
        assert_eq!(
            parse_docker_layer_phase("Extracting 2MB/2MB"),
            Some(DockerLayerPhase::Extracting(1.0))
        );
        assert_eq!(
            parse_docker_layer_phase("Pull complete"),
            Some(DockerLayerPhase::Complete)
        );
        assert_eq!(parse_docker_layer_phase("Digest: sha256:abc"), None);
    }
}

/// Stop the OpenClaw Docker container (without removing it).
#[tauri::command]
pub async fn stop_docker_gateway(
    state: State<'_, crate::state::GatewayProcess>,
) -> Result<String, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let result = stop_docker_gateway_locked().await;
    if result.is_ok() {
        state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Stopped),
            Some(crate::state::gateway_process::GatewayRuntimeMode::None),
            None,
            "stop_docker_gateway: container stopped",
        );
    }
    result
}

pub(crate) async fn stop_docker_gateway_locked() -> Result<String, String> {
    let docker_bin = resolve_docker_bin().await?;

    let output = tokio::process::Command::new(&docker_bin)
        .args(["stop", OPENCLAW_CONTAINER_NAME])
        .output()
        .await
        .map_err(|e| format!("Failed to stop container: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // If container doesn't exist, that's fine
        if !stderr.contains("No such container") {
            return Err(format!("docker stop failed: {}", stderr));
        }
    }

    Ok("Docker gateway stopped".into())
}

/// Check if the Docker container is running.
#[tauri::command]
pub async fn docker_gateway_status(port: Option<u16>) -> Result<GatewayStatus, String> {
    let port = port.unwrap_or_else(docker_gateway_configured_port);
    let docker_bin = match resolve_docker_bin().await {
        Ok(bin) => bin,
        Err(_) => {
            return Ok(GatewayStatus {
                running: false,
                port,
                pid: None,
                token: None,
            });
        }
    };

    let output = tokio::process::Command::new(&docker_bin)
        .args([
            "inspect",
            "--format",
            "{{.State.Running}}",
            OPENCLAW_CONTAINER_NAME,
        ])
        .output()
        .await;

    match output {
        Ok(o) if o.status.success() => {
            let running = String::from_utf8_lossy(&o.stdout).trim() == "true";
            Ok(GatewayStatus {
                running,
                port,
                pid: None,
                token: None,
            })
        }
        _ => Ok(GatewayStatus {
            running: false,
            port,
            pid: None,
            token: None,
        }),
    }
}
