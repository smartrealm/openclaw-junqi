//! Gateway 启动兜底编排器。
//!
//! 统一入口：先探测本机 Gateway，再检查托管子进程，最后尝试 Docker 兜底。
//! 这里只防止并发重复执行，不做失败后的长时间冷却；用户刚修复配置或
//! 启动 Docker 后，应能立刻再次自救。
//!
//! 前端在冷启动、手动重连、自救入口里都应调用这里，而不是各自拼接
//! 多套恢复流程。

use crate::commands::docker::{check_docker, docker_gateway_status, start_docker_gateway};
use crate::state::gateway_process::{push_log, LogLevel, LogSource};
use crate::state::GatewayProcess;
use serde::Serialize;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

/// 兜底编排最终落在哪种运行方式上。
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
    /// 本次是否尝试过兜底路径。UI 用它决定是否提示“已切换/尝试恢复”。
    pub attempted_fallback: bool,
    pub error: Option<String>,
}

static ENSURE_IN_FLIGHT: Mutex<bool> = Mutex::new(false);

struct EnsureRunGuard;

impl EnsureRunGuard {
    fn try_enter() -> Result<Option<Self>, String> {
        let mut in_flight = ENSURE_IN_FLIGHT.lock().map_err(|e| e.to_string())?;
        if *in_flight {
            return Ok(None);
        }
        *in_flight = true;
        Ok(Some(Self))
    }
}

impl Drop for EnsureRunGuard {
    fn drop(&mut self) {
        if let Ok(mut in_flight) = ENSURE_IN_FLIGHT.lock() {
            *in_flight = false;
        }
    }
}

/// 确认指定端口是否能接受 Gateway TCP 连接。
async fn probe_gateway_port(port: u16) -> bool {
    crate::commands::gateway::is_gateway_serving(port).await
}

/// 从当前本机配置读取 Gateway token。
fn read_gateway_token() -> Option<String> {
    use crate::paths;
    let raw = std::fs::read_to_string(&paths::config_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(|s| s.to_string())
}

/// 从 JunQi 管理的 Docker 配置读取 Gateway token。
fn read_docker_gateway_token() -> Option<String> {
    use crate::paths;
    let path = paths::desktop_dir().join("docker").join("openclaw.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(|s| s.to_string())
}

/// 从 openclaw.json 读取 Gateway 端口；读不到时回退到 OpenClaw 默认端口。
fn read_gateway_port() -> u16 {
    use crate::paths;
    let raw = match std::fs::read_to_string(&paths::config_path()) {
        Ok(raw) => raw,
        Err(_) => return 18789,
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return 18789,
    };
    v.get("gateway")
        .and_then(|g| g.get("port"))
        .and_then(|p| p.as_u64())
        .filter(|p| *p > 0 && *p < 65536)
        .map(|p| p as u16)
        .unwrap_or(18789)
}

/// 冷启动/手动自救共用的 Gateway 恢复入口。
///
/// 规则：
/// 1. 配置端口已可连接，直接返回 Native/healthy。
/// 2. 托管子进程还活着但端口未就绪，记录诊断日志。
/// 3. Docker 可用时尝试容器兜底，并等待端口就绪。
/// 4. 失败时返回明确错误，但不设置冷却，用户修复后可立即重试。
#[tauri::command]
pub async fn ensure_gateway_running(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<EnsureResult, String> {
    let Some(_ensure_guard) = EnsureRunGuard::try_enter()? else {
        let configured_port = read_gateway_port();
        let state_port = *state.port.lock().map_err(|e| e.to_string())?;
        let port = if configured_port > 0 {
            configured_port
        } else {
            state_port
        };
        if probe_gateway_port(port).await {
            let token = read_gateway_token();
            return Ok(EnsureResult {
                mode: GatewayMode::Native,
                healthy: true,
                port,
                token,
                attempted_fallback: false,
                error: None,
            });
        }
        return Ok(EnsureResult {
            mode: GatewayMode::Unavailable,
            healthy: false,
            port,
            token: None,
            attempted_fallback: false,
            error: Some("Gateway recovery is already running".to_string()),
        });
    };

    let port = read_gateway_port();
    *state.port.lock().map_err(|e| e.to_string())? = port;

    // 1. 本机配置端口已经可用，直接复用。
    if probe_gateway_port(port).await {
        let token = read_gateway_token();
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
    let managed_alive = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    };
    if managed_alive {
        push_log(&state.logs, LogSource::Lifecycle, LogLevel::Warn,
                 format!("ensure_gateway_running: managed native child alive but gateway port was not reachable on {}", port));
    }

    // 3. Docker 兜底。
    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Warn,
        "ensure_gateway_running: native unhealthy, attempting Docker fallback",
    );
    match check_docker().await {
        Ok(ds) if ds.daemon_running => {
            // 容器存在时先尝试复用；不存在则启动新容器。
            let present = docker_gateway_status(Some(port))
                .await
                .map(|s| s.running)
                .unwrap_or(false);
            let mut docker_token = read_docker_gateway_token();
            if !present {
                match start_docker_gateway(app.clone(), Some(port), None).await {
                    Ok(status) => {
                        docker_token = status.token.or_else(read_docker_gateway_token);
                    }
                    Err(e) => {
                        let err = format!("docker fallback failed: {}", e);
                        push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
                        return Ok(EnsureResult {
                            mode: GatewayMode::Unavailable,
                            healthy: false,
                            port,
                            token: None,
                            attempted_fallback: true,
                            error: Some(err),
                        });
                    }
                }
            }
            // 等待容器内 Gateway 端口就绪。
            for _ in 0..30 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if probe_gateway_port(port).await {
                    let token = docker_token.or_else(read_docker_gateway_token);
                    push_log(
                        &state.logs,
                        LogSource::Lifecycle,
                        LogLevel::Info,
                        "ensure_gateway_running: docker fallback succeeded",
                    );
                    return Ok(EnsureResult {
                        mode: GatewayMode::Docker,
                        healthy: true,
                        port,
                        token,
                        attempted_fallback: true,
                        error: None,
                    });
                }
            }
            let err = "Docker container up but gateway port never became reachable within 30s"
                .to_string();
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
            return Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: true,
                error: Some(err),
            });
        }
        Ok(_) => {
            let err =
                "Docker unavailable — install Docker Desktop or run openclaw natively".to_string();
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Warn, &err);
            Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: false,
                error: Some(err),
            })
        }
        Err(e) => {
            let err = format!("Docker check failed: {}", e);
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
            Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: false,
                error: Some(err),
            })
        }
    }
}

// Pull `app` into the manager trait surface so `app.state::<GatewayProcess>()`
// can be called from any helper above that needs to look up state.
#[allow(dead_code)]
fn _state_lookup_helper(app: &AppHandle) -> State<'_, GatewayProcess> {
    app.state::<GatewayProcess>()
}
