//! Gateway 开机自启（系统服务）管理。
//!
//! 通过官方 CLI 的 `gateway install/uninstall/status` 注册或移除系统级
//! 服务（macOS LaunchAgent / Linux systemd / Windows schtasks）。仅 Native
//! 运行时支持：Docker 容器的存活由容器重启策略负责，宿主机服务无法
//! 管理容器内的 Gateway 进程。

use serde::Serialize;
use std::time::Duration;

use crate::commands::openclaw_cli;
use crate::paths::{self, OpenClawRuntimeMode};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAutostartStatus {
    /// 当前选定的运行时是否支持系统服务自启（仅 Native）。
    pub supported: bool,
    /// 服务是否已注册并被系统加载（重启后会自动运行）。
    pub enabled: bool,
    /// 系统服务形态，例如 "LaunchAgent" / "systemd"。
    pub service_label: Option<String>,
}

fn unsupported_status() -> GatewayAutostartStatus {
    GatewayAutostartStatus {
        supported: false,
        enabled: false,
        service_label: None,
    }
}

fn autostart_from_status_payload(payload: &serde_json::Value) -> GatewayAutostartStatus {
    let service = payload.get("service");
    GatewayAutostartStatus {
        supported: true,
        enabled: service
            .and_then(|service| service.get("loaded"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        service_label: service
            .and_then(|service| service.get("label"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string),
    }
}

fn cli_failure(action: &str, output: &openclaw_cli::CliOutput) -> String {
    let detail = if output.stderr.is_empty() {
        &output.stdout
    } else {
        &output.stderr
    };
    if detail.is_empty() {
        format!("OpenClaw gateway {action} failed")
    } else {
        format!("OpenClaw gateway {action} failed: {detail}")
    }
}

async fn query_autostart_status() -> Result<GatewayAutostartStatus, String> {
    let output = openclaw_cli::run_openclaw(
        &["gateway", "status", "--json", "--no-probe"],
        None,
        Duration::from_secs(30),
    )
    .await?;
    if !output.success {
        return Err(cli_failure("status", &output));
    }
    let payload = openclaw_cli::parse_json_payload(&output.stdout)?;
    Ok(autostart_from_status_payload(&payload))
}

#[tauri::command]
pub async fn gateway_autostart_status() -> Result<GatewayAutostartStatus, String> {
    if !matches!(paths::active_runtime_mode(), OpenClawRuntimeMode::Native) {
        return Ok(unsupported_status());
    }
    query_autostart_status().await
}

#[tauri::command]
pub async fn enable_gateway_autostart() -> Result<GatewayAutostartStatus, String> {
    if !matches!(paths::active_runtime_mode(), OpenClawRuntimeMode::Native) {
        return Err("Gateway autostart requires the Native runtime".into());
    }
    // --force 让重复点击具备修复语义：已存在但损坏的服务定义会被重写。
    let output = openclaw_cli::run_openclaw(
        &["gateway", "install", "--json", "--force"],
        None,
        Duration::from_secs(120),
    )
    .await?;
    if !output.success {
        return Err(cli_failure("install", &output));
    }
    // 安装结果以系统的实际加载状态为准，而不是 install 命令的退出码。
    let status = query_autostart_status().await?;
    if !status.enabled {
        return Err(
            "Gateway service was installed but the system did not report it as loaded".into(),
        );
    }
    Ok(status)
}

#[tauri::command]
pub async fn disable_gateway_autostart() -> Result<GatewayAutostartStatus, String> {
    if !matches!(paths::active_runtime_mode(), OpenClawRuntimeMode::Native) {
        return Ok(unsupported_status());
    }
    let output =
        openclaw_cli::run_openclaw(&["gateway", "uninstall"], None, Duration::from_secs(60))
            .await?;
    if !output.success {
        return Err(cli_failure("uninstall", &output));
    }
    query_autostart_status().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loaded_service_reports_enabled_with_label() {
        let payload = serde_json::json!({
            "service": { "label": "LaunchAgent", "loaded": true }
        });
        let status = autostart_from_status_payload(&payload);
        assert!(status.supported);
        assert!(status.enabled);
        assert_eq!(status.service_label.as_deref(), Some("LaunchAgent"));
    }

    #[test]
    fn unloaded_service_reports_disabled() {
        let payload = serde_json::json!({
            "service": { "label": "systemd", "loaded": false }
        });
        let status = autostart_from_status_payload(&payload);
        assert!(status.supported);
        assert!(!status.enabled);
        assert_eq!(status.service_label.as_deref(), Some("systemd"));
    }

    #[test]
    fn missing_service_section_reports_disabled() {
        let payload = serde_json::json!({ "cli": { "version": "2026.7.1" } });
        let status = autostart_from_status_payload(&payload);
        assert!(status.supported);
        assert!(!status.enabled);
        assert_eq!(status.service_label, None);
    }

    #[test]
    fn cli_failure_prefers_stderr_and_falls_back_to_stdout() {
        let with_stderr = openclaw_cli::CliOutput {
            success: false,
            stdout: "ignored".into(),
            stderr: "permission denied".into(),
        };
        assert!(cli_failure("install", &with_stderr).contains("permission denied"));
        let stdout_only = openclaw_cli::CliOutput {
            success: false,
            stdout: "not supported".into(),
            stderr: String::new(),
        };
        assert!(cli_failure("install", &stdout_only).contains("not supported"));
        let silent = openclaw_cli::CliOutput {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
        };
        assert_eq!(
            cli_failure("uninstall", &silent),
            "OpenClaw gateway uninstall failed"
        );
    }
}
