//! Gateway 启动编排器。
//!
//! 统一入口：先探测当前选定的运行时，再启动其托管进程。
//! Native/Docker 是持久化的用户选择，失败时保持在同一契约内，不静默
//! 切换到另一套 state/config。这里只防止并发重复执行，不做失败后的
//! 长时间冷却；用户修复配置后可以立刻再次自救。
//!
//! 前端在冷启动、手动重连、自救入口里都应调用这里，而不是各自拼接
//! 多套恢复流程。

use crate::commands::docker::{check_docker, docker_gateway_status, start_docker_gateway_locked};
use crate::paths::{self, OpenClawRuntimeMode};
use crate::state::gateway_process::{
    push_log, GatewayLifecycle, GatewayRuntimeMode, LogLevel, LogSource,
};
use crate::state::GatewayProcess;
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// 编排最终落在哪种运行方式上。
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GatewayMode {
    /// Our managed native child (or an existing user-owned native gateway).
    Native,
    /// Docker container (`maxauto-openclaw`).
    Docker,
    /// Nothing reachable.
    Unavailable,
}

/// `ensure_gateway_running` 的结构化结果。
#[derive(Debug, Serialize)]
pub struct EnsureResult {
    pub mode: GatewayMode,
    pub healthy: bool,
    pub port: u16,
    pub token: Option<String>,
    /// Wire-compatible legacy field. Selected-runtime-only startup keeps this false.
    pub attempted_fallback: bool,
    pub error: Option<String>,
}

/// Confirms that the native endpoint is both live and belongs to JunQi's
/// currently selected state/config pair. `/healthz` alone is not ownership:
/// another OpenClaw state directory may use the same port with another token.
async fn selected_native_gateway_ready(port: u16) -> bool {
    crate::commands::gateway::gateway_matches_config(port, &paths::config_path()).await
}

/// Confirms that the selected Docker endpoint is live and accepts the Docker
/// configuration's current authentication identity. Liveness alone can belong
/// to another Gateway process bound to the same host port.
async fn docker_gateway_matches_selected_config(port: u16, config_path: &std::path::Path) -> bool {
    crate::commands::gateway::gateway_matches_config(port, config_path).await
}

async fn selected_docker_gateway_ready(port: u16) -> bool {
    docker_gateway_matches_selected_config(port, &paths::docker_config_path()).await
}

/// 从当前本机配置读取 Gateway token。
fn read_gateway_token(config_path: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let v = crate::commands::config::parse_openclaw_config(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .filter(|token| !token.trim().is_empty())
        .map(|s| s.to_string())
}

/// 从 JunQi 管理的 Docker 配置读取 Gateway token。
pub(crate) fn read_docker_gateway_token() -> Option<String> {
    read_gateway_token(&paths::docker_config_path())
}

/// 从 openclaw.json 读取 Gateway 端口；读不到时回退到 OpenClaw 默认端口。
fn read_gateway_port() -> u16 {
    let raw = match std::fs::read_to_string(paths::active_config_path()) {
        Ok(raw) => raw,
        Err(_) => return crate::commands::config::default_gateway_port(),
    };
    let v = match crate::commands::config::parse_openclaw_config(&raw) {
        Ok(v) => v,
        Err(_) => return crate::commands::config::default_gateway_port(),
    };
    crate::commands::config::gateway_port_from_config(&v)
        .unwrap_or_else(crate::commands::config::default_gateway_port)
}

/// Recover the explicitly selected Docker runtime without invoking native
/// OpenClaw. Docker users should never be silently switched to a separate
/// native state directory during a self-recovery attempt.
async fn ensure_selected_docker_gateway(
    app: AppHandle,
    state: &GatewayProcess,
    port: u16,
) -> Result<EnsureResult, String> {
    let docker_running = docker_gateway_status(Some(port))
        .await
        .map(|status| status.running)
        .unwrap_or(false);
    if docker_running && selected_docker_gateway_ready(port).await {
        let token = read_docker_gateway_token();
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(GatewayRuntimeMode::Docker),
            None,
            "ensure_gateway_running: selected Docker gateway is healthy",
        );
        return Ok(EnsureResult {
            mode: GatewayMode::Docker,
            healthy: true,
            port,
            token,
            attempted_fallback: false,
            error: None,
        });
    }

    match check_docker().await {
        Ok(status) if status.daemon_running => {
            crate::commands::docker::release_managed_native_gateway_for_docker(state, port).await?;
            match start_docker_gateway_locked(app, Some(port), None).await {
                Ok(status) => {
                    state.transition(
                        Some(GatewayLifecycle::Running),
                        Some(GatewayRuntimeMode::Docker),
                        None,
                        "ensure_gateway_running: selected Docker gateway started",
                    );
                    Ok(EnsureResult {
                        mode: GatewayMode::Docker,
                        healthy: status.running,
                        port: status.port,
                        token: status.token.or_else(read_docker_gateway_token),
                        attempted_fallback: false,
                        error: None,
                    })
                }
                Err(error) => {
                    state.transition(
                        Some(GatewayLifecycle::Error),
                        Some(GatewayRuntimeMode::Docker),
                        None,
                        "ensure_gateway_running: selected Docker gateway failed",
                    );
                    Ok(EnsureResult {
                        mode: GatewayMode::Unavailable,
                        healthy: false,
                        port,
                        token: None,
                        attempted_fallback: false,
                        error: Some(format!("Selected Docker Gateway failed to start: {error}")),
                    })
                }
            }
        }
        Ok(_) => Ok(EnsureResult {
            mode: GatewayMode::Unavailable,
            healthy: false,
            port,
            token: None,
            attempted_fallback: false,
            error: Some("Docker is selected but its daemon is unavailable".to_string()),
        }),
        Err(error) => Ok(EnsureResult {
            mode: GatewayMode::Unavailable,
            healthy: false,
            port,
            token: None,
            attempted_fallback: false,
            error: Some(format!(
                "Docker is selected but could not be checked: {error}"
            )),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::docker_gateway_matches_selected_config;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn isolated_config_path(name: &str) -> std::path::PathBuf {
        std::env::temp_dir()
            .join(format!(
                "junqi-ensure-docker-{name}-{}",
                uuid::Uuid::new_v4()
            ))
            .join("openclaw.json")
    }

    async fn serve_gateway_identity_probe(
        accepted_token: &str,
    ) -> (u16, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test gateway");
        let port = listener
            .local_addr()
            .expect("read test gateway port")
            .port();
        let accepted_token = accepted_token.to_owned();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().await.expect("accept gateway probe");
                let mut request_bytes = [0_u8; 2048];
                let size = stream
                    .read(&mut request_bytes)
                    .await
                    .expect("read gateway probe");
                let request = String::from_utf8_lossy(&request_bytes[..size]);
                let authorized = request.lines().any(|line| {
                    line.split_once(':').is_some_and(|(name, value)| {
                        name.eq_ignore_ascii_case("authorization")
                            && value.trim() == format!("Bearer {accepted_token}")
                    })
                });
                let (status, body) = if request.starts_with("GET /healthz ") {
                    ("200 OK", r#"{"ok":true,"status":"live"}"#)
                } else if authorized {
                    ("404 Not Found", "")
                } else {
                    ("401 Unauthorized", "")
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len(),
                );
                stream
                    .write_all(response.as_bytes())
                    .await
                    .expect("write gateway probe");
            }
        });
        (port, server)
    }

    fn write_gateway_config(path: &std::path::Path, port: u16, token: &str) {
        std::fs::create_dir_all(path.parent().expect("config parent"))
            .expect("create config parent");
        std::fs::write(
            path,
            serde_json::json!({
                "gateway": {
                    "port": port,
                    "auth": { "token": token },
                },
            })
            .to_string(),
        )
        .expect("write gateway config");
    }

    #[tokio::test]
    async fn docker_fast_path_rejects_a_healthy_endpoint_with_a_different_bearer_token() {
        let config_path = isolated_config_path("identity");

        let (foreign_port, foreign_server) = serve_gateway_identity_probe("foreign-token").await;
        write_gateway_config(&config_path, foreign_port, "selected-token");
        assert!(
            !docker_gateway_matches_selected_config(foreign_port, &config_path).await,
            "a healthy endpoint with another Docker token must not be reused"
        );
        tokio::time::timeout(std::time::Duration::from_secs(2), foreign_server)
            .await
            .expect("foreign endpoint should receive both probes")
            .expect("foreign endpoint task should finish");

        let (selected_port, selected_server) = serve_gateway_identity_probe("selected-token").await;
        write_gateway_config(&config_path, selected_port, "selected-token");
        assert!(docker_gateway_matches_selected_config(selected_port, &config_path).await);
        tokio::time::timeout(std::time::Duration::from_secs(2), selected_server)
            .await
            .expect("selected endpoint should receive both probes")
            .expect("selected endpoint task should finish");

        let _ = std::fs::remove_dir_all(config_path.parent().expect("config parent"));
    }
}

/// 冷启动/手动自救共用的 Gateway 恢复入口。
///
/// 规则：
/// 1. 配置端口已可连接，直接复用当前选定运行时。
/// 2. 启动当前选定的托管 Gateway，并等待端口就绪。
/// 3. 失败时返回明确错误；切换运行时必须经过显式设置流程。
#[tauri::command]
pub async fn ensure_gateway_running(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<EnsureResult, String> {
    // All lifecycle mutations share this gate. A concurrent ensure waits for
    // the active operation, then re-probes and reuses its result.
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;

    let selected_mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(selected_mode)?;
    let port = read_gateway_port();
    *state.port.lock().map_err(|e| e.to_string())? = port;

    if matches!(selected_mode, OpenClawRuntimeMode::Docker) {
        return ensure_selected_docker_gateway(app, &state, port).await;
    }

    let (recorded_mode, managed_pid) = crate::commands::gateway::inspect_gateway_owner(&state)?;

    // 1. 本机配置端口已经可用，直接复用。
    if selected_native_gateway_ready(port).await {
        let token = read_gateway_token(&paths::config_path());
        // A service may already be healthy before JunQi starts, while the
        // in-memory owner is still None/External. Re-attest the official
        // service identity before downgrading that local durable owner to an
        // externally managed Gateway.
        let selected_service_running = if managed_pid.is_none()
            && !matches!(recorded_mode, GatewayRuntimeMode::SystemService)
        {
            crate::commands::gateway_service::inspect_selected_native_gateway_service()
                .await
                .is_ok_and(crate::commands::gateway_service::is_running_selected_service)
        } else {
            false
        };
        let serving_mode = if managed_pid.is_some() {
            GatewayRuntimeMode::ManagedChild
        } else if matches!(recorded_mode, GatewayRuntimeMode::SystemService)
            || selected_service_running
        {
            GatewayRuntimeMode::SystemService
        } else {
            GatewayRuntimeMode::External
        };
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(serving_mode),
            None,
            "ensure_gateway_running: existing endpoint is healthy",
        );
        push_log(
            &state.logs,
            LogSource::Lifecycle,
            LogLevel::Info,
            format!("ensure_gateway_running: native healthy on port {}", port),
        );
        return Ok(EnsureResult {
            mode: GatewayMode::Native,
            healthy: true,
            port,
            token,
            attempted_fallback: false,
            error: None,
        });
    }

    // 2. 托管子进程仍在，但端口暂未可用，记录诊断信息。
    let managed_alive = managed_pid.is_some();
    if managed_alive {
        push_log(&state.logs, LogSource::Lifecycle, LogLevel::Warn,
                 format!("ensure_gateway_running: managed native child alive but gateway port was not reachable on {}", port));
    }

    // 3. 启动选定的原生 Gateway owner。启动链会先核验已安装服务；
    // 只有确认服务不存在时才会创建桌面托管子进程。
    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Info,
        "ensure_gateway_running: reconciling selected native gateway owner",
    );
    let native_error = match crate::commands::gateway::start_gateway_locked(
        app.clone(),
        app.state::<GatewayProcess>(),
        Some(port),
    )
    .await
    {
        Ok(status) => {
            for _ in 0..45 {
                if selected_native_gateway_ready(port).await {
                    let token = status
                        .token
                        .or_else(|| read_gateway_token(&paths::config_path()));
                    push_log(
                        &state.logs,
                        LogSource::Lifecycle,
                        LogLevel::Info,
                        "ensure_gateway_running: selected native gateway healthy",
                    );
                    return Ok(EnsureResult {
                        mode: GatewayMode::Native,
                        healthy: true,
                        port,
                        token,
                        attempted_fallback: false,
                        error: None,
                    });
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            format!(
                "desktop-managed native gateway did not become reachable on port {}",
                port
            )
        }
        Err(error) => format!("desktop-managed native gateway failed: {}", error),
    };
    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Error,
        &native_error,
    );

    let err = format!(
        "{}; the selected Native runtime was not changed. Choose Docker explicitly if you want to use the container runtime.",
        native_error
    );
    push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
    state.transition(
        Some(GatewayLifecycle::Error),
        Some(GatewayRuntimeMode::None),
        None,
        "ensure_gateway_running: selected Native runtime failed",
    );
    Ok(EnsureResult {
        mode: GatewayMode::Unavailable,
        healthy: false,
        port,
        token: None,
        attempted_fallback: false,
        error: Some(err),
    })
}
