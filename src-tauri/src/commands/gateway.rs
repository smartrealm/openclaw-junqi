use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode, GatewayRuntimeState};
use crate::state::GatewayProcess;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// Literal gateway auth token when one exists. SecretRef-managed values are
    /// deliberately not materialized across the native/renderer boundary.
    pub token: Option<String>,
}

async fn stop_offline_gateway_service(
    app: &AppHandle,
    runtime: &crate::commands::system::NativeOpenclawRuntime,
    state_dir: &std::path::Path,
    config_path: &std::path::Path,
    search_path: &str,
    inspection: crate::commands::gateway_service::GatewayServiceInspection,
) -> Result<bool, String> {
    let stopped = crate::commands::gateway_service::stop_selected_gateway_service_verified(
        runtime,
        state_dir,
        config_path,
        Some(search_path),
        inspection,
    )
    .await?;
    if stopped {
        let _ = app.emit(
            "gateway-log",
            "Stopped the selected OpenClaw system service before starting the desktop-managed Gateway.",
        );
    }
    Ok(stopped)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GatewayObservation {
    ManagedChildReady,
    ManagedChildUnready,
    ManagedChildExited,
    EndpointHealthy,
    EndpointOffline,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GatewayRestartTarget {
    OfficialService,
    ManagedChild,
}

/// The official wizard can leave a selected service already running, install a
/// selected service without starting it, or leave a service bound to an old
/// runtime. These are distinct handoff states: treating all three as a fresh
/// start can wait for a port that the already-correct service legitimately
/// owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OfficialGatewayHandoff {
    RetainCurrentOwner,
    StartSelected,
    RebindStale { stop_running_service: bool },
}

fn official_gateway_handoff(
    inspection: crate::commands::gateway_service::GatewayServiceInspection,
) -> Result<Option<OfficialGatewayHandoff>, String> {
    use crate::commands::gateway_service::GatewayServiceOwnership;

    if !inspection.installed {
        return Ok(None);
    }
    let handoff = match inspection.ownership {
        GatewayServiceOwnership::SelectedState if inspection.running => {
            Some(OfficialGatewayHandoff::RetainCurrentOwner)
        }
        GatewayServiceOwnership::SelectedState => Some(OfficialGatewayHandoff::StartSelected),
        GatewayServiceOwnership::StaleRuntime => Some(OfficialGatewayHandoff::RebindStale {
            stop_running_service: inspection.running,
        }),
        GatewayServiceOwnership::StaleLocale => Some(OfficialGatewayHandoff::RebindStale {
            stop_running_service: inspection.running,
        }),
        GatewayServiceOwnership::Absent => {
            return Err("OpenClaw reported an installed Gateway service without an inspectable service definition".into());
        }
        GatewayServiceOwnership::Foreign => {
            return Err("The installed OpenClaw Gateway service belongs to a different state directory; JunQi left it untouched".into());
        }
        GatewayServiceOwnership::Unverifiable => {
            return Err("The installed OpenClaw Gateway service ownership could not be verified; JunQi left it untouched".into());
        }
    };
    Ok(handoff)
}

/// Immutable runtime contract for a single official Gateway handoff. Keeping
/// all service operations on this snapshot prevents a concurrent path or
/// storage selection from mixing an old service identity with a new config.
struct OfficialGatewayHandoffContext<'a> {
    state_dir: std::path::PathBuf,
    config_path: &'a std::path::Path,
    runtime: &'a crate::commands::system::NativeOpenclawRuntime,
    search_path: &'a str,
    port: u16,
}

impl<'a> OfficialGatewayHandoffContext<'a> {
    fn service_identity(&self) -> crate::commands::gateway_service::GatewayServiceIdentity {
        crate::commands::gateway_service::GatewayServiceIdentity::for_runtime(
            &self.state_dir,
            self.config_path,
            self.runtime,
        )
    }
}

/// A failed official-service handoff can only be rolled back when this
/// operation displaced a foreground child owned by JunQi.  Never invent a
/// managed owner for a setup that did not have one before the handoff.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OfficialGatewayHandoffFailureRecovery {
    RestoreManagedChild,
    SurfaceFailure,
}

fn official_gateway_handoff_failure_recovery(
    had_managed_child: bool,
) -> OfficialGatewayHandoffFailureRecovery {
    if had_managed_child {
        OfficialGatewayHandoffFailureRecovery::RestoreManagedChild
    } else {
        OfficialGatewayHandoffFailureRecovery::SurfaceFailure
    }
}

fn restart_target_for_service(
    ownership: Option<crate::commands::gateway_service::GatewayServiceOwnership>,
) -> GatewayRestartTarget {
    if matches!(
        ownership,
        Some(
            crate::commands::gateway_service::GatewayServiceOwnership::SelectedState
                | crate::commands::gateway_service::GatewayServiceOwnership::StaleRuntime
                | crate::commands::gateway_service::GatewayServiceOwnership::StaleLocale,
        )
    ) {
        GatewayRestartTarget::OfficialService
    } else {
        GatewayRestartTarget::ManagedChild
    }
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
            let mode = if matches!(
                paths::active_runtime_mode(),
                paths::OpenClawRuntimeMode::Docker
            ) {
                GatewayRuntimeMode::Docker
            } else {
                match current.mode {
                    GatewayRuntimeMode::External
                    | GatewayRuntimeMode::SystemService
                    | GatewayRuntimeMode::Docker => current.mode,
                    GatewayRuntimeMode::None | GatewayRuntimeMode::ManagedChild => {
                        GatewayRuntimeMode::External
                    }
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

    #[test]
    fn official_service_restart_requires_a_matching_service_identity() {
        use crate::commands::gateway_service::GatewayServiceOwnership;

        assert_eq!(
            restart_target_for_service(Some(GatewayServiceOwnership::SelectedState)),
            GatewayRestartTarget::OfficialService
        );
        assert_eq!(
            restart_target_for_service(Some(GatewayServiceOwnership::StaleRuntime)),
            GatewayRestartTarget::OfficialService
        );
        assert_eq!(
            restart_target_for_service(Some(GatewayServiceOwnership::StaleLocale)),
            GatewayRestartTarget::OfficialService
        );
        for ownership in [
            Some(GatewayServiceOwnership::Absent),
            Some(GatewayServiceOwnership::Foreign),
            Some(GatewayServiceOwnership::Unverifiable),
            None,
        ] {
            assert_eq!(
                restart_target_for_service(ownership),
                GatewayRestartTarget::ManagedChild
            );
        }
    }

    #[test]
    fn wizard_handoff_preserves_an_already_running_selected_service() {
        use crate::commands::gateway_service::{GatewayServiceInspection, GatewayServiceOwnership};

        let selected_running = GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: true,
            running: true,
        };
        assert_eq!(
            official_gateway_handoff(selected_running).unwrap(),
            Some(OfficialGatewayHandoff::RetainCurrentOwner)
        );
        assert_eq!(
            official_gateway_handoff(GatewayServiceInspection {
                running: false,
                ..selected_running
            })
            .unwrap(),
            Some(OfficialGatewayHandoff::StartSelected)
        );
        assert_eq!(
            official_gateway_handoff(GatewayServiceInspection {
                ownership: GatewayServiceOwnership::StaleRuntime,
                running: true,
                ..selected_running
            })
            .unwrap(),
            Some(OfficialGatewayHandoff::RebindStale {
                stop_running_service: true,
            })
        );
        assert!(official_gateway_handoff(GatewayServiceInspection {
            ownership: GatewayServiceOwnership::Foreign,
            ..selected_running
        })
        .is_err());
        assert_eq!(
            official_gateway_handoff(GatewayServiceInspection {
                ownership: GatewayServiceOwnership::Absent,
                installed: false,
                running: false,
            })
            .unwrap(),
            None
        );
    }

    #[test]
    fn wizard_handoff_failure_restores_only_a_displaced_managed_child() {
        assert_eq!(
            official_gateway_handoff_failure_recovery(true),
            OfficialGatewayHandoffFailureRecovery::RestoreManagedChild
        );
        assert_eq!(
            official_gateway_handoff_failure_recovery(false),
            OfficialGatewayHandoffFailureRecovery::SurfaceFailure
        );
    }

    #[test]
    fn managed_gateway_diagnostics_only_include_current_child_output() {
        use crate::state::gateway_process::{LogEntry, LogLevel, LogSource};
        use std::collections::VecDeque;

        let state = GatewayProcess::new();
        *state.logs.lock().unwrap() = VecDeque::from([
            LogEntry {
                timestamp_ms: 10,
                level: LogLevel::Error,
                source: LogSource::ChildStderr,
                message: "old failure".into(),
            },
            LogEntry {
                timestamp_ms: 20,
                level: LogLevel::Warn,
                source: LogSource::Lifecycle,
                message: "lifecycle noise".into(),
            },
            LogEntry {
                timestamp_ms: 30,
                level: LogLevel::Error,
                source: LogSource::ChildStderr,
                message: "missing plugin entry".into(),
            },
        ]);

        assert_eq!(
            managed_gateway_diagnostics(&state, 20, 8),
            "missing plugin entry"
        );
    }

    #[test]
    fn gateway_health_requires_the_documented_openclaw_identity_payload() {
        assert!(gateway_health_payload_is_healthy(
            &serde_json::json!({ "ok": true, "status": "live" })
        ));
        assert!(!gateway_health_payload_is_healthy(
            &serde_json::json!({ "ok": true })
        ));
        assert!(!gateway_health_payload_is_healthy(
            &serde_json::json!({ "status": "live" })
        ));
        assert!(!gateway_health_payload_is_healthy(
            &serde_json::json!({ "ok": true, "status": "ready" })
        ));
    }

    #[test]
    fn authenticated_gateway_probe_requires_an_authenticated_response() {
        assert!(gateway_auth_probe_accepts(reqwest::StatusCode::OK));
        assert!(gateway_auth_probe_accepts(reqwest::StatusCode::NOT_FOUND));
        assert!(!gateway_auth_probe_accepts(
            reqwest::StatusCode::UNAUTHORIZED
        ));
        assert!(!gateway_auth_probe_accepts(reqwest::StatusCode::FORBIDDEN));
        assert!(!gateway_auth_probe_accepts(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR
        ));
    }

    async fn serve_health_response_once(body: &str) -> u16 {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = body.to_owned();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 512];
            let size = stream.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..size]);
            let (status, response_body) = if request.starts_with("GET /healthz ") {
                ("200 OK", body.as_str())
            } else {
                ("404 Not Found", "")
            };
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                response_body.len(),
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });
        port
    }

    #[tokio::test]
    async fn gateway_health_probe_accepts_only_the_live_openclaw_response() {
        let healthy_port = serve_health_response_once(r#"{"ok":true,"status":"live"}"#).await;
        assert!(is_gateway_healthy(healthy_port).await);

        let unrelated_port = serve_health_response_once(r#"{"ok":true}"#).await;
        assert!(!is_gateway_healthy(unrelated_port).await);
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
    fn gateway_readers_accept_the_openclaw_json5_config_format() {
        let path = isolated_config_path("json5-config");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{
                // OpenClaw accepts JSON5 comments and trailing commas.
                gateway: {
                    port: 19876,
                    auth: { token: 'json5-token', },
                },
            }"#,
        )
        .unwrap();

        assert_eq!(ConfigMetadata::load(&path).port, 19876);
        assert_eq!(read_gateway_token(&path).as_deref(), Some("json5-token"));

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
        let config: serde_json::Value = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();

        assert_eq!(token.as_deref(), Some("existing"));
        assert!(config["gateway"]["auth"].get("mode").is_none());
        assert_eq!(config["gateway"]["auth"]["token"], "existing");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn incompatible_existing_gateway_bind_is_rejected_without_mutation() {
        let path = isolated_config_path("existing-gateway-policy");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = r#"{
            gateway: {
                mode: 'local',
                bind: 'tailnet',
                port: 19991,
                auth: { token: 'existing' },
                controlUi: { allowedOrigins: ['https://example.test'], allowInsecureAuth: false }
            }
        }"#;
        std::fs::write(&path, original).unwrap();

        let error = ensure_config_with_token(&path, 18789, "loopback").unwrap_err();
        assert!(error.contains("tailnet"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn remote_gateway_mode_is_rejected_without_mutating_config() {
        let path = isolated_config_path("remote-gateway-mode");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = r#"{"gateway":{"mode":"remote","auth":{"token":"existing"}}}"#;
        std::fs::write(&path, original).unwrap();

        let error = ensure_config_with_token(&path, 18789, "loopback").unwrap_err();
        assert!(error.contains("remote"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn secretref_gateway_token_is_preserved_and_control_ui_origins_are_merged() {
        let path = isolated_config_path("secretref-gateway-token");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = r#"{
            "gateway": {
                "mode": "local",
                "bind": "loopback",
                "port": 18789,
                "auth": {"token": {"source":"env","provider":"default","id":"OPENCLAW_TOKEN"}},
                "controlUi": {"allowedOrigins": ["https://example.test"], "allowInsecureAuth": false}
            }
        }"#;
        std::fs::write(&path, original).unwrap();

        let token = ensure_config_with_token(&path, 18789, "loopback").unwrap();
        assert_eq!(token, None);
        let config = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();
        assert_eq!(config["gateway"]["auth"]["token"]["source"], "env");
        assert_eq!(config["gateway"]["controlUi"]["allowInsecureAuth"], false);
        let origins = config["gateway"]["controlUi"]["allowedOrigins"]
            .as_array()
            .unwrap();
        assert_eq!(origins[0], "https://example.test");
        assert!(origins.iter().any(|origin| origin == "tauri://localhost"));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn gateway_locale_is_seeded_into_gateway_config() {
        let path = isolated_config_path("gateway-locale");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"gateway":{"auth":{"token":"existing"}}}"#).unwrap();

        ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap();
        let config: serde_json::Value = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();

        assert_eq!(
            config["env"]["vars"]["OPENCLAW_LOCALE"],
            crate::commands::system::managed_openclaw_locale()
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn existing_gateway_locale_remains_gateway_owned() {
        let path = isolated_config_path("existing-gateway-locale");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"gateway":{"auth":{"token":"existing"}},"env":{"vars":{"OPENCLAW_LOCALE":"zh-TW"}}}"#,
        )
        .unwrap();

        ensure_config_with_token(
            &path,
            crate::commands::config::default_gateway_port(),
            "loopback",
        )
        .unwrap();
        let config: serde_json::Value = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();

        assert_eq!(config["env"]["vars"]["OPENCLAW_LOCALE"], "zh-TW");
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
        .unwrap()
        .unwrap();
        let config: serde_json::Value = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();

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

    #[test]
    fn fresh_gateway_config_keeps_device_auth_enabled() {
        let path = isolated_config_path("fresh-secure-control-ui");
        let token = ensure_config_with_token(&path, 18789, "loopback")
            .unwrap()
            .expect("fresh config has a literal token");
        let config = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&path).unwrap(),
        )
        .unwrap();
        assert_eq!(token.len(), 64);
        assert!(config["gateway"]["controlUi"]
            .get("allowInsecureAuth")
            .is_none());
        assert!(config["gateway"]["controlUi"]
            .get("dangerouslyDisableDeviceAuth")
            .is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn official_secret_resolution_selects_only_the_gateway_token_assignment() {
        let payload = serde_json::json!({
            "assignments": [
                {"path": "models.providers.demo.apiKey", "pathSegments": ["models", "providers", "demo", "apiKey"], "value": "other-secret"},
                {"pathSegments": ["gateway", "auth", "token"], "value": " resolved-token "}
            ]
        });
        assert_eq!(
            gateway_token_from_resolution_payload(&payload).as_deref(),
            Some("resolved-token")
        );
    }

    #[test]
    fn environment_token_templates_are_not_exposed_as_literal_tokens() {
        let path = isolated_config_path("env-token-template");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"gateway":{"auth":{"token":"${OPENCLAW_GATEWAY_TOKEN}"}}}"#,
        )
        .unwrap();
        assert_eq!(read_gateway_token(&path), None);
        assert!(gateway_uses_secret_reference(&path));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

/// Build a PATH that includes bundled Node.js, our openclaw prefix,
/// and common native install locations — same approach as openclaw-desktop.
fn augmented_path() -> String {
    crate::commands::system::openclaw_search_path()
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
            .and_then(|raw| crate::commands::config::parse_openclaw_config(&raw).ok());

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

/// Seed the Gateway-owned locale once when JunQi creates or adopts a local
/// config. Subsequent wizard responses are rendered by Gateway itself; this
/// value is not a client-side translation preference.
fn ensure_gateway_locale_config(config: &mut serde_json::Value) -> Result<(), String> {
    let root = config
        .as_object_mut()
        .ok_or("OpenClaw config root must be an object")?;
    let env = root.entry("env").or_insert_with(|| serde_json::json!({}));
    let env_obj = env
        .as_object_mut()
        .ok_or("OpenClaw config `env` must be an object")?;
    let vars = env_obj
        .entry("vars")
        .or_insert_with(|| serde_json::json!({}));
    let vars_obj = vars
        .as_object_mut()
        .ok_or("OpenClaw config `env.vars` must be an object")?;
    match vars_obj.get("OPENCLAW_LOCALE") {
        Some(value) if !value.is_string() => {
            Err("OpenClaw config `env.vars.OPENCLAW_LOCALE` must be a string".into())
        }
        Some(_) => Ok(()),
        None => {
            vars_obj.insert(
                "OPENCLAW_LOCALE".into(),
                serde_json::json!(crate::commands::system::managed_openclaw_locale()),
            );
            Ok(())
        }
    }
}

pub(crate) fn gateway_port_for_config(config_path: &std::path::Path) -> u16 {
    ConfigMetadata::load(config_path).port
}

/// Resolve the user-configured Gateway port for commands that need to target
/// the Control UI without assuming OpenClaw's default port.
pub(crate) fn configured_gateway_port() -> u16 {
    ConfigMetadata::load(&paths::active_config_path()).port
}

/// Read the gateway auth token from the config file.
/// Returns `None` if the file is missing, malformed, or has no token.
fn read_gateway_token(config_path: &std::path::Path) -> Option<String> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let v = crate::commands::config::parse_openclaw_config(&raw).ok()?;
    crate::commands::config::literal_gateway_token_from_config(&v)
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
) -> Result<Option<String>, String> {
    if port == 0 {
        return Err("Gateway port must be between 1 and 65535".into());
    }
    const REQUIRED_CONTROL_UI_ORIGINS: [&str; 4] = [
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
        "http://localhost:5173",
    ];

    fn secret_input_is_configured(value: Option<&serde_json::Value>) -> bool {
        match value {
            Some(serde_json::Value::String(value)) => !value.trim().is_empty(),
            Some(serde_json::Value::Object(_)) => true,
            _ => false,
        }
    }

    fn normalize_managed_gateway(
        config: &mut serde_json::Value,
        port: u16,
        bind: &str,
        required_origins: &[&str],
    ) -> Result<Option<String>, String> {
        let gateway = config
            .as_object_mut()
            .ok_or("Config is not an object")?
            .entry("gateway")
            .or_insert_with(|| serde_json::json!({}));
        let gateway = gateway.as_object_mut().ok_or("gateway is not an object")?;

        match gateway.get("bind") {
            Some(value) if value.as_str() != Some(bind) => {
                let configured = value.as_str().unwrap_or("<invalid>");
                return Err(format!(
                    "Gateway bind `{configured}` is incompatible with JunQi's managed `{bind}` runtime; choose a compatible runtime or update gateway.bind first"
                ));
            }
            None => {
                gateway.insert("bind".into(), serde_json::json!(bind));
            }
            _ => {}
        }
        match gateway.get("port") {
            Some(value) if value.as_u64() != Some(u64::from(port)) => {
                return Err(format!(
                    "Gateway port `{}` does not match the selected managed port `{port}`",
                    value
                ));
            }
            None => {
                gateway.insert("port".into(), serde_json::json!(port));
            }
            _ => {}
        }
        gateway
            .entry("mode")
            .or_insert_with(|| serde_json::json!("local"));

        let control_ui = gateway
            .entry("controlUi")
            .or_insert_with(|| serde_json::json!({}));
        let control_ui = control_ui
            .as_object_mut()
            .ok_or("gateway.controlUi must be an object")?;
        let allowed = control_ui
            .entry("allowedOrigins")
            .or_insert_with(|| serde_json::json!([]));
        let allowed = allowed
            .as_array_mut()
            .ok_or("gateway.controlUi.allowedOrigins must be an array")?;
        if allowed.iter().any(|origin| !origin.is_string()) {
            return Err("gateway.controlUi.allowedOrigins entries must be strings".into());
        }
        for origin in required_origins {
            if !allowed
                .iter()
                .any(|existing| existing.as_str() == Some(origin))
            {
                allowed.push(serde_json::json!(origin));
            }
        }

        let auth = gateway
            .entry("auth")
            .or_insert_with(|| serde_json::json!({}));
        let auth = auth
            .as_object_mut()
            .ok_or("gateway.auth must be an object")?;
        let existing_token = auth.get("token").cloned();
        match existing_token {
            Some(serde_json::Value::String(value)) if !value.trim().is_empty() => {
                if crate::commands::config::gateway_token_string_is_reference(&value) {
                    Ok(None)
                } else {
                    Ok(Some(value.trim().to_string()))
                }
            }
            Some(serde_json::Value::Object(_)) => Ok(None),
            Some(serde_json::Value::Null) | None | Some(serde_json::Value::String(_)) => {
                let token = generate_token()?;
                auth.insert("token".into(), serde_json::json!(token));
                Ok(Some(token))
            }
            Some(_) => Err("gateway.auth.token must be a string or SecretRef object".into()),
        }
    }

    // 默认工作区落在 JunQi 管理目录下，避免首次启动时依赖用户 shell 环境。
    let default_workspace = paths::default_workspace_dir();
    let default_workspace_str = default_workspace.to_string_lossy().to_string();

    if config_path.exists() {
        // Read existing config and extract token
        let raw = std::fs::read_to_string(config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config = crate::commands::config::parse_openclaw_config(&raw)
            .map_err(|error| format!("Failed to parse config: {}", error))?;

        let auth_config = config
            .get("gateway")
            .and_then(|gateway| gateway.get("auth"));
        if let Some(mode_value) = config
            .get("gateway")
            .and_then(|gateway| gateway.get("mode"))
        {
            let mode = mode_value.as_str().ok_or("gateway.mode must be a string")?;
            if mode != "local" {
                return Err(format!(
                    "Gateway mode `{mode}` is not compatible with JunQi's local Gateway lifecycle; select a local Gateway configuration first"
                ));
            }
        }
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
        } else if secret_input_is_configured(auth_config.and_then(|auth| auth.get("password"))) {
            return Err(
                "Gateway password authentication is configured without an explicit auth mode; select a Gateway authentication mode before JunQi adds a token"
                    .into(),
            );
        }

        let mut config = config;
        let token =
            normalize_managed_gateway(&mut config, port, bind, &REQUIRED_CONTROL_UI_ORIGINS)?;
        ensure_gateway_locale_config(&mut config)?;
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
            "controlUi": {
                "allowedOrigins": REQUIRED_CONTROL_UI_ORIGINS
            }
        },
        "env": {
            "vars": {
                "OPENCLAW_LOCALE": crate::commands::system::managed_openclaw_locale()
            }
        }
    });
    write_openclaw_config_safely(config_path, &default_config)?;

    Ok(Some(token))
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
                let is_operator =
                    entry_obj.get("role").and_then(|r| r.as_str()) == Some("operator");
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

fn gateway_token_from_resolution_payload(payload: &serde_json::Value) -> Option<String> {
    payload
        .get("assignments")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .find_map(|assignment| {
            let is_gateway_token = assignment.get("path").and_then(serde_json::Value::as_str)
                == Some("gateway.auth.token")
                || assignment
                    .get("pathSegments")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|segments| {
                        segments
                            .iter()
                            .filter_map(serde_json::Value::as_str)
                            .eq(["gateway", "auth", "token"])
                    });
            if !is_gateway_token {
                return None;
            }
            assignment
                .get("value")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

async fn resolve_gateway_token_with_official_cli(
    config_path: &std::path::Path,
) -> Result<String, String> {
    const RESOLVE_PARAMS: &str = r#"{"commandName":"junqi gateway connection","targetIds":["gateway.auth.token"],"allowedPaths":["gateway.auth.token"],"forcedActivePaths":["gateway.auth.token"]}"#;
    let output = crate::commands::openclaw_cli::run_openclaw(
        &[
            "gateway",
            "call",
            "secrets.resolve",
            "--params",
            RESOLVE_PARAMS,
            "--json",
            "--timeout",
            "15000",
        ],
        Some(config_path),
        std::time::Duration::from_secs(20),
    )
    .await?;
    if !output.success {
        return Err("OpenClaw could not resolve the configured Gateway SecretRef".into());
    }
    let payload = crate::commands::openclaw_cli::parse_cli_json(&output)
        .map_err(|_| "OpenClaw returned an invalid SecretRef resolution response".to_string())?;
    gateway_token_from_resolution_payload(&payload)
        .ok_or_else(|| "OpenClaw did not resolve gateway.auth.token".to_string())
}

/// Resolve the selected Gateway credential without changing its config form.
/// Literal values are returned directly; SecretRefs stay in openclaw.json and
/// are materialized by OpenClaw's own resolver only for the active connection.
#[tauri::command]
pub async fn get_gateway_token() -> Result<String, String> {
    let config_path = paths::active_config_path();
    if !config_path.exists() {
        return Err("Config not found".into());
    }
    if let Some(token) = read_gateway_token(&config_path) {
        return Ok(token);
    }
    if gateway_uses_secret_reference(&config_path) {
        return resolve_gateway_token_with_official_cli(&config_path).await;
    }
    Err("No Gateway token found in config".into())
}

/// Returns true only when the local OpenClaw Gateway exposes its dedicated
/// health endpoint. A raw TCP connection proves only that *some* process owns
/// the port; treating it as success lets an unrelated local service bypass the
/// installer and later fail during the WebSocket handshake.
///
/// `/healthz` is OpenClaw's documented liveness endpoint. It avoids the noisy
/// incomplete WebSocket handshakes produced by protocol probes while still
/// verifying the service identity. `/readyz` stays red while optional startup
/// work settles, so it is not appropriate for process ownership.
const OPENCLAW_GATEWAY_LIVENESS_PATH: &str = "healthz";
const GATEWAY_AUTH_PROBE_SESSION_KEY: &str = "junqi-gateway-identity-probe";

fn gateway_health_payload_is_healthy(payload: &serde_json::Value) -> bool {
    payload.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
        && payload.get("status").and_then(serde_json::Value::as_str) == Some("live")
}

pub async fn is_gateway_healthy(port: u16) -> bool {
    let endpoint = format!(
        "http://{}:{}/{}",
        crate::commands::config::default_gateway_host(),
        port,
        OPENCLAW_GATEWAY_LIVENESS_PATH,
    );
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(400))
        .timeout(std::time::Duration::from_millis(700))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let response = match client.get(endpoint).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return false,
    };
    response
        .json::<serde_json::Value>()
        .await
        .map(|payload| gateway_health_payload_is_healthy(&payload))
        .unwrap_or(false)
}

fn gateway_auth_probe_accepts(status: reqwest::StatusCode) -> bool {
    // The session-history route authenticates before resolving the session. A
    // 404 therefore proves the bearer token was accepted for our deliberately
    // nonexistent probe key, while 200 covers the unlikely name collision.
    status.is_success() || status == reqwest::StatusCode::NOT_FOUND
}

async fn gateway_accepts_configured_token(port: u16, token: &str) -> bool {
    if token.trim().is_empty() {
        return false;
    }
    let endpoint = format!(
        "http://{}:{}/sessions/{}/history?limit=1",
        crate::commands::config::default_gateway_host(),
        port,
        GATEWAY_AUTH_PROBE_SESSION_KEY,
    );
    let client = match reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_millis(400))
        .timeout(std::time::Duration::from_millis(900))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .map(|response| gateway_auth_probe_accepts(response.status()))
        .unwrap_or(false)
}

pub(crate) async fn gateway_matches_config(port: u16, config_path: &std::path::Path) -> bool {
    if ConfigMetadata::load(config_path).port != port || !is_gateway_healthy(port).await {
        return false;
    }
    if let Some(token) = read_gateway_token(config_path) {
        return gateway_accepts_configured_token(port, &token).await;
    }
    if !gateway_uses_secret_reference(config_path) {
        return false;
    }
    official_gateway_rpc_accepts_selected_config(config_path, port).await
}

fn gateway_uses_secret_reference(config_path: &std::path::Path) -> bool {
    let config = std::fs::read_to_string(config_path)
        .ok()
        .and_then(|raw| crate::commands::config::parse_openclaw_config(&raw).ok());
    let Some(token) = config
        .as_ref()
        .and_then(|config| config.get("gateway"))
        .and_then(|gateway| gateway.get("auth"))
        .and_then(|auth| auth.get("token"))
    else {
        return false;
    };
    token.is_object()
        || token
            .as_str()
            .is_some_and(crate::commands::config::gateway_token_string_is_reference)
}

struct OfficialGatewayProbeCache {
    config_path: std::path::PathBuf,
    config_fingerprint: [u8; 32],
    port: u16,
    checked_at: std::time::Instant,
    ready: bool,
}

fn official_gateway_probe_cache() -> &'static tokio::sync::Mutex<Option<OfficialGatewayProbeCache>>
{
    static CACHE: std::sync::OnceLock<tokio::sync::Mutex<Option<OfficialGatewayProbeCache>>> =
        std::sync::OnceLock::new();
    CACHE.get_or_init(|| tokio::sync::Mutex::new(None))
}

async fn official_gateway_rpc_accepts_selected_config(
    config_path: &std::path::Path,
    port: u16,
) -> bool {
    let config_fingerprint: [u8; 32] = match std::fs::read(config_path) {
        Ok(raw) => Sha256::digest(raw).into(),
        Err(_) => return false,
    };
    let mut cache = official_gateway_probe_cache().lock().await;
    if let Some(cached) = cache.as_ref() {
        if cached.config_path == config_path
            && cached.config_fingerprint == config_fingerprint
            && cached.port == port
            && cached.checked_at.elapsed() < std::time::Duration::from_secs(3)
        {
            return cached.ready;
        }
    }
    let ready = match crate::commands::openclaw_cli::run_openclaw(
        &[
            "gateway",
            "status",
            "--json",
            "--require-rpc",
            "--timeout",
            "3000",
        ],
        Some(config_path),
        std::time::Duration::from_secs(8),
    )
    .await
    {
        Ok(output) if output.success => crate::commands::openclaw_cli::parse_cli_json(&output)
            .ok()
            .and_then(|payload| payload.get("rpc")?.get("ok")?.as_bool())
            .unwrap_or(false),
        _ => false,
    };
    *cache = Some(OfficialGatewayProbeCache {
        config_path: config_path.to_path_buf(),
        config_fingerprint,
        port,
        checked_at: std::time::Instant::now(),
        ready,
    });
    ready
}

fn emit_restart_progress(app: &AppHandle, line: impl AsRef<str>) {
    let line = line.as_ref().to_string();
    let _ = app.emit("gateway-restart-progress", &line);
    let _ = app.emit("gateway-log", &line);
}

pub(crate) async fn wait_for_selected_gateway(
    port: u16,
    config_path: &std::path::Path,
    timeout_secs: u64,
) -> bool {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if gateway_matches_config(port, config_path).await {
            return true;
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    false
}

// A freshly installed OpenClaw/Node.js pair is untouched by Windows Defender's
// on-access scanner; its first execution (this readiness wait) can stall for
// tens of seconds while the scanner works through node.exe and the package's
// full node_modules tree before the process produces any output at all. 60s
// was tuned for an already-scanned/cached binary; give a cold start headroom
// instead of killing a Gateway that is merely slow to start for the first time.
const MANAGED_GATEWAY_START_TIMEOUT_SECS: u64 = 90;
const MANAGED_GATEWAY_START_HEARTBEAT_SECS: u64 = 15;

fn managed_gateway_diagnostics(state: &GatewayProcess, started_at_ms: i64, limit: usize) -> String {
    let Ok(logs) = state.logs.lock() else {
        return String::new();
    };
    let mut lines = logs
        .iter()
        .rev()
        .filter(|entry| {
            entry.timestamp_ms >= started_at_ms
                && matches!(
                    entry.source,
                    crate::state::gateway_process::LogSource::ChildStdout
                        | crate::state::gateway_process::LogSource::ChildStderr
                )
        })
        .filter_map(|entry| {
            let message = entry.message.trim();
            (!message.is_empty()).then(|| message.to_string())
        })
        .take(limit)
        .collect::<Vec<_>>();
    lines.reverse();
    lines.join("\n")
}

fn with_managed_gateway_diagnostics(
    message: String,
    state: &GatewayProcess,
    started_at_ms: i64,
) -> String {
    let diagnostics = managed_gateway_diagnostics(state, started_at_ms, 8);
    if diagnostics.is_empty() {
        message
    } else {
        format!("{}\nRecent Gateway output:\n{}", message, diagnostics)
    }
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
    let config_path = paths::active_config_path();
    if wait_for_selected_gateway(port, &config_path, 45).await {
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
            let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
            if line.is_empty() {
                continue;
            }
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
            let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
            if line.is_empty() {
                continue;
            }
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
    // Snapshot mode, config, and port only after taking the lifecycle gate so
    // a concurrent setup selection cannot pair a new mode with an old config.
    let selected_mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(selected_mode)?;
    crate::commands::system::validate_openclaw_binary_override()?;
    let config_path = paths::active_config_path();
    let meta = ConfigMetadata::load(&config_path);
    let port = port.unwrap_or(meta.port);
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

    if matches!(selected_mode, paths::OpenClawRuntimeMode::Docker) {
        crate::commands::docker::release_managed_native_gateway_for_docker(&state, port).await?;
        state.transition(
            Some(GatewayLifecycle::Reconnecting),
            Some(GatewayRuntimeMode::Docker),
            Some(true),
            "restart_gateway: recreating selected Docker container",
        );
        emit_restart_progress(&app, "Recreating the selected OpenClaw Docker container...");
        let result =
            crate::commands::docker::start_docker_gateway_locked(app.clone(), Some(port), None)
                .await;
        match &result {
            Ok(_) => state.transition(
                Some(GatewayLifecycle::Running),
                Some(GatewayRuntimeMode::Docker),
                Some(false),
                "restart_gateway: Docker container is healthy",
            ),
            Err(_) => state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::Docker),
                Some(false),
                "restart_gateway: Docker container restart failed",
            ),
        }
        return result;
    }

    crate::commands::system::ensure_openclaw_relocation_complete()?;

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

    let openclaw = crate::commands::system::resolve_openclaw_binary_async()
        .await
        .ok_or_else(|| "OpenClaw not found. Run: npm install -g openclaw".to_string())?;
    let node_requirement =
        crate::commands::system::node_requirement_for_openclaw_binary(&openclaw)?;
    let node =
        crate::commands::setup::ensure_compatible_node_runtime(&app, "gateway", &node_requirement)
            .await
            .map_err(|error| format!("Gateway runtime repair failed: {error}"))?;
    let runtime = crate::commands::system::native_openclaw_runtime(openclaw, &node)?;
    let gw_path = augmented_path();

    if paths::pending_gateway_service_rebind().is_some() {
        emit_restart_progress(
            &app,
            "Rebinding the Gateway service to the selected Node.js/npm/config locations...",
        );
        crate::commands::gateway_service::reconcile_pending_gateway_service(
            &runtime,
            &paths::desktop_dir(),
            &config_path,
            port,
            Some(&gw_path),
        )
        .await?;
    }

    let service_identity = crate::commands::gateway_service::GatewayServiceIdentity::for_runtime(
        &paths::desktop_dir(),
        &config_path,
        &runtime,
    );
    emit_restart_progress(
        &app,
        "Inspecting the installed OpenClaw Gateway service identity...",
    );
    let inspection = crate::commands::gateway_service::inspect_gateway_service_state(
        &runtime,
        &service_identity,
        Some(&gw_path),
    )
    .await;
    let (ownership, stale_service_running) = match inspection {
        Ok(inspection)
            if inspection.installed
                && matches!(
                    inspection.ownership,
                    crate::commands::gateway_service::GatewayServiceOwnership::StaleRuntime
                        | crate::commands::gateway_service::GatewayServiceOwnership::StaleLocale
                ) =>
        {
            (Ok(inspection.ownership), Some(inspection.running))
        }
        Ok(inspection) if inspection.installed => (Ok(inspection.ownership), None),
        Ok(_) => (
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::Absent),
            None,
        ),
        Err(error) => (Err(error), None),
    };
    let restart_target = restart_target_for_service(ownership.as_ref().ok().copied());
    if restart_target == GatewayRestartTarget::ManagedChild {
        let reason = match ownership {
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::Absent) => {
                "No official OpenClaw Gateway service is installed for the selected state"
                    .to_string()
            }
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::Foreign) => {
                "The installed OpenClaw Gateway service belongs to another state or config"
                    .to_string()
            }
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::Unverifiable) => {
                "The installed OpenClaw Gateway service does not declare a complete state/config identity"
                    .to_string()
            }
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::StaleRuntime) => {
                "The installed OpenClaw Gateway service still references an old Node.js or OpenClaw package path"
                    .to_string()
            }
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::StaleLocale) => {
                "The installed OpenClaw Gateway service uses a different locale than the selected Gateway configuration"
                    .to_string()
            }
            Ok(crate::commands::gateway_service::GatewayServiceOwnership::SelectedState) => {
                unreachable!("selected service must use the official restart path")
            }
            Err(error) => format!("Could not verify the installed Gateway service: {error}"),
        };
        drop(_restart_guard);
        return start_managed_gateway_fallback(app, state.clone(), port, reason).await;
    }

    emit_restart_progress(
        &app,
        format!("Restarting OpenClaw Gateway service on port {}...", port),
    );

    if stale_service_running == Some(true) {
        let stopped = crate::commands::gateway_service::stop_selected_gateway_service(
            &runtime,
            &paths::desktop_dir(),
            &config_path,
            Some(&gw_path),
        )
        .await?;
        if !stopped {
            return Err(
                "The stale selected Gateway service changed before it could be stopped".into(),
            );
        }
    }

    // Stop any foreground gateway spawned by this desktop app only after the
    // official service has been proven to belong to the selected state/config.
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
            let reason = format!(
                "Gateway process was terminated, but port {} did not become available: {}",
                port, error
            );
            emit_restart_progress(&app, &reason);
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "restart_gateway: owned child terminated but port remained occupied",
            );
            return Err(reason);
        }
    }

    if let Some(was_running) = stale_service_running {
        emit_restart_progress(
            &app,
            "The Gateway service uses an old Node.js or OpenClaw package path; rebuilding it...",
        );
        crate::commands::gateway_service::rebind_selected_gateway_service(
            &runtime,
            &paths::desktop_dir(),
            &config_path,
            port,
            was_running,
            Some(&gw_path),
        )
        .await
        .map_err(|error| format!("Failed to rebuild stale Gateway service: {error}"))?;
    }

    // Restart the installed Gateway service (launchd/systemd/schtasks). This is
    // the real local OpenClaw restart path; unlike start_gateway(), it does not
    // simply return success when an external listener is already serving.
    let context = service_identity.command_context(Some(&gw_path));
    let mut cmd = runtime.command(&context);
    cmd.args(["gateway", "restart"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

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
    if wait_for_selected_gateway(port, &config_path, 45).await {
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

    let reason = "Gateway service restart completed but health check did not pass in time for JunQi's selected state directory";
    drop(_restart_guard);
    start_managed_gateway_fallback(app, state.clone(), port, reason).await
}

/// Roll back a partially completed official-service handoff.  The caller
/// already owns `GatewayProcess::operation_gate`, so stopping the selected
/// service and recreating the foreground child are one serialized lifecycle
/// transaction rather than two independently racing operations.
async fn recover_failed_official_gateway_handoff(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    context: &OfficialGatewayHandoffContext<'_>,
    had_managed_child: bool,
    stale_service_stop_attempted: bool,
    handoff_error: String,
) -> Result<bool, String> {
    if matches!(
        official_gateway_handoff_failure_recovery(had_managed_child),
        OfficialGatewayHandoffFailureRecovery::SurfaceFailure
    ) {
        if stale_service_stop_attempted {
            return restore_stale_gateway_after_failed_handoff(app, state, context, handoff_error)
                .await;
        }
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::None),
            None,
            "wizard handoff: official service failed without a managed child to restore",
        );
        return Err(handoff_error);
    }

    let recovery_notice = format!(
        "Official Gateway handoff failed: {handoff_error}. Restoring the desktop-managed Gateway..."
    );
    emit_restart_progress(&app, &recovery_notice);
    crate::state::gateway_process::push_log(
        &state.logs,
        crate::state::gateway_process::LogSource::Lifecycle,
        crate::state::gateway_process::LogLevel::Warn,
        recovery_notice,
    );

    // The service identity is checked again inside this helper.  This keeps
    // rollback ownership-safe if the official CLI changed its service state
    // between the initial inspection and the failed start/health check.
    if let Err(error) = crate::commands::gateway_service::stop_selected_gateway_service(
        context.runtime,
        &context.state_dir,
        context.config_path,
        Some(context.search_path),
    )
    .await
    {
        let reason = format!(
            "{handoff_error}; rollback could not stop the selected official Gateway service: {error}"
        );
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::None),
            None,
            "wizard handoff: official service cleanup failed during rollback",
        );
        return Err(reason);
    }

    if let Err(error) =
        crate::commands::gateway_supervisor::wait_for_port_free(context.port, 30_000).await
    {
        let reason = format!(
            "{handoff_error}; rollback stopped the selected official service but port {} remained occupied: {error}",
            context.port
        );
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::None),
            None,
            "wizard handoff: rollback port cleanup failed",
        );
        return Err(reason);
    }

    match start_gateway_locked(app.clone(), state.clone(), Some(context.port)).await {
        Ok(status) if status.running => {
            let _ = app.emit(
                "gateway-log",
                "Desktop-managed Gateway restored after official service handoff failed.",
            );
            Ok(false)
        }
        Ok(status) => {
            let reason = format!(
                "{handoff_error}; rollback returned a non-running desktop Gateway status on port {}",
                status.port
            );
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "wizard handoff: rollback returned a non-running Gateway",
            );
            Err(reason)
        }
        Err(error) => {
            let reason = format!(
                "{handoff_error}; rollback could not restore the desktop-managed Gateway: {error}"
            );
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "wizard handoff: managed Gateway rollback failed",
            );
            Err(reason)
        }
    }
}

/// A stale official service can be the sole pre-handoff owner. If its stop
/// command may have taken effect but JunQi had no foreground child to restore,
/// restart only after re-verifying that the shared platform service is still
/// bound to the selected state/config contract.
async fn restore_stale_gateway_after_failed_handoff(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    context: &OfficialGatewayHandoffContext<'_>,
    handoff_error: String,
) -> Result<bool, String> {
    let identity = context.service_identity();
    let inspection = crate::commands::gateway_service::inspect_gateway_service_state(
        context.runtime,
        &identity,
        Some(context.search_path),
    )
    .await
    .map_err(|error| {
        format!("{handoff_error}; rollback could not inspect the stale Gateway service: {error}")
    })?;
    if !crate::commands::gateway_service::belongs_to_selected_state(inspection.ownership)
        || !inspection.installed
    {
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::None),
            None,
            "wizard handoff: stale service changed before rollback",
        );
        return Err(format!(
            "{handoff_error}; the stale Gateway service changed before it could be safely restored"
        ));
    }
    crate::commands::gateway_service::start_selected_gateway_service_with_path(
        context.runtime,
        &context.state_dir,
        context.config_path,
        Some(context.search_path),
    )
    .await
    .map_err(|error| {
        format!("{handoff_error}; rollback could not restart the stale Gateway service: {error}")
    })?;
    if !wait_for_selected_gateway(context.port, context.config_path, 45).await {
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::None),
            None,
            "wizard handoff: stale service did not become healthy after rollback",
        );
        return Err(format!(
            "{handoff_error}; stale Gateway service did not become healthy after rollback"
        ));
    }
    state.transition(
        Some(GatewayLifecycle::Running),
        Some(GatewayRuntimeMode::SystemService),
        Some(false),
        "wizard handoff: stale Gateway service restored after failure",
    );
    let _ = app.emit(
        "gateway-log",
        "Official Gateway service was restored after a failed handoff.",
    );
    Ok(false)
}

/// Complete the lifecycle handoff after the official OpenClaw wizard. The
/// wizard may install/start its platform service by default; when that service
/// declares JunQi's selected state/config, stop our foreground child first and
/// let the official service become the single owner. Foreign or unverifiable
/// services are left untouched.
#[tauri::command]
pub async fn handoff_gateway_to_official_service(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<bool, String> {
    if matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Docker
    ) {
        return Ok(false);
    }
    let operation_gate = state.operation_gate.clone();
    let _guard = operation_gate.lock_owned().await;
    let config_path = paths::active_config_path();
    let port = ConfigMetadata::load(&config_path).port;
    let openclaw = crate::commands::system::resolve_openclaw_binary_async()
        .await
        .ok_or_else(|| "OpenClaw binary not found while handing off Gateway service".to_string())?;
    let requirement = crate::commands::system::node_requirement_for_openclaw_binary(&openclaw)?;
    let node = crate::commands::system::check_node_for_requirement(&requirement).await?;
    let runtime = crate::commands::system::native_openclaw_runtime(openclaw, &node)?;
    let search_path = augmented_path();
    let context = OfficialGatewayHandoffContext {
        state_dir: paths::desktop_dir(),
        config_path: &config_path,
        runtime: &runtime,
        search_path: &search_path,
        port,
    };
    let identity = context.service_identity();
    let inspection = crate::commands::gateway_service::inspect_gateway_service_state(
        context.runtime,
        &identity,
        Some(context.search_path),
    )
    .await;
    let inspection = inspection.map_err(|error| {
        let message = format!("Official Gateway service inspection failed after wizard: {error}");
        let _ = app.emit("gateway-log", &message);
        message
    })?;
    let Some(handoff) = official_gateway_handoff(inspection)? else {
        return Ok(false);
    };
    let child = {
        let mut lock = state.child.lock().map_err(|error| error.to_string())?;
        lock.take()
    };
    let had_managed_child = child.is_some();
    if let Some(mut child) = child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
    }

    // Everything after the foreground child is displaced is part of one
    // recoverable transaction.  A failed port wait, service rebind, service
    // start, or health check must not leave the wizard without a Gateway.
    let mut stale_service_stop_attempted = false;
    let handoff_result: Result<(), String> = async {
        if matches!(
            handoff,
            OfficialGatewayHandoff::RebindStale {
                stop_running_service: true
            }
        ) {
            // Mark before awaiting: a CLI timeout/error can happen after the
            // platform service has already observed the stop request.
            stale_service_stop_attempted = true;
            if !crate::commands::gateway_service::stop_selected_gateway_service(
                context.runtime,
                &context.state_dir,
                context.config_path,
                Some(context.search_path),
            )
            .await?
            {
                return Err("The stale selected Gateway service changed before handoff".into());
            }
        }
        if had_managed_child && !matches!(handoff, OfficialGatewayHandoff::RetainCurrentOwner)
        {
            crate::commands::gateway_supervisor::wait_for_port_free(context.port, 30_000)
                .await
                .map_err(|error| {
                    format!(
                        "The desktop-managed Gateway stopped, but port {} did not become available: {}",
                        context.port, error
                    )
                })?;
        }
        if matches!(handoff, OfficialGatewayHandoff::RebindStale { .. }) {
            // The handoff always needs an active official owner. Rebind in a
            // stopped state, then perform exactly one explicit start below.
            crate::commands::gateway_service::rebind_selected_gateway_service(
                context.runtime,
                &context.state_dir,
                context.config_path,
                context.port,
                false,
                Some(context.search_path),
            )
            .await
            .map_err(|error| format!("Failed to rebuild the stale Gateway service: {error}"))?;
        }
        if !matches!(handoff, OfficialGatewayHandoff::RetainCurrentOwner) {
            crate::commands::gateway_service::start_selected_gateway_service_with_path(
                context.runtime,
                &context.state_dir,
                context.config_path,
                Some(context.search_path),
            )
            .await
            .map_err(|error| format!("Failed to start the official Gateway service: {error}"))?;
        }
        if !wait_for_selected_gateway(context.port, context.config_path, 45).await {
            return Err(format!(
                "Official Gateway service did not become ready on port {} after wizard handoff",
                context.port
            ));
        }
        Ok(())
    }
    .await;
    if let Err(error) = handoff_result {
        return recover_failed_official_gateway_handoff(
            app,
            state,
            &context,
            had_managed_child,
            stale_service_stop_attempted,
            error,
        )
        .await;
    }
    state.transition(
        Some(GatewayLifecycle::Running),
        Some(GatewayRuntimeMode::SystemService),
        Some(false),
        "wizard handoff: official Gateway service is now the owner",
    );
    let _ = app.emit(
        "gateway-log",
        "Official OpenClaw Gateway service is now the selected lifecycle owner.",
    );
    Ok(true)
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
    // Read the mode only after acquiring the same gate used by the mode
    // selector. A pre-lock snapshot can launch Native while bootstrap already
    // says Docker (or vice versa), leaving the next restart on the wrong owner.
    let selected_mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(selected_mode)?;
    if matches!(selected_mode, paths::OpenClawRuntimeMode::Docker) {
        let target_port =
            port.unwrap_or_else(crate::commands::docker::docker_gateway_configured_port);
        crate::commands::docker::release_managed_native_gateway_for_docker(&state, target_port)
            .await?;
        state.transition(
            Some(GatewayLifecycle::Starting),
            None,
            None,
            "start_gateway: starting selected Docker runtime",
        );
        let result =
            crate::commands::docker::start_docker_gateway_locked(app, Some(target_port), None)
                .await;
        state.transition(
            Some(if result.is_ok() {
                GatewayLifecycle::Running
            } else {
                GatewayLifecycle::Error
            }),
            Some(if result.is_ok() {
                GatewayRuntimeMode::Docker
            } else {
                GatewayRuntimeMode::None
            }),
            None,
            if result.is_ok() {
                "start_gateway: selected Docker runtime is healthy"
            } else {
                "start_gateway: selected Docker runtime failed"
            },
        );
        return result;
    }
    start_gateway_locked(app, state, port).await
}

/// Start implementation for callers that already own `operation_gate`.
pub(crate) async fn start_gateway_locked(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    port: Option<u16>,
) -> Result<GatewayStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Err("Native Gateway start rejected because Docker is the selected runtime".into());
    }
    paths::validate_runtime_mode(paths::OpenClawRuntimeMode::Native)?;
    crate::commands::system::validate_openclaw_binary_override()?;
    crate::commands::system::ensure_openclaw_relocation_complete()?;
    // Load config metadata once. This single read serves both port resolution
    // and env_vars injection, avoiding duplicate IO later in the function.
    let config_path = paths::config_path();
    let meta = ConfigMetadata::load(&config_path);
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

    // OpenClaw enforces a non-contiguous Node.js support matrix. Repair the
    // desktop-managed runtime before spawning so an incompatible system Node
    // cannot produce a crash/retry loop (notably Node 24.14.x on Windows).
    let openclaw = crate::commands::system::resolve_openclaw_binary_async()
        .await
        .ok_or_else(|| "OpenClaw not found. Run: npm install -g openclaw".to_string())?;
    let node_requirement =
        crate::commands::system::node_requirement_for_openclaw_binary(&openclaw)?;
    let node =
        crate::commands::setup::ensure_compatible_node_runtime(&app, "gateway", &node_requirement)
            .await
            .map_err(|error| format!("Gateway runtime repair failed: {error}"))?;

    let base_dir = paths::desktop_dir();
    let node_path = node
        .path
        .as_deref()
        .map(std::path::Path::new)
        .ok_or("The compatible Node.js runtime did not report an executable path")?;
    crate::commands::openclaw_state_dir::verify_node_state_directory(node_path, &base_dir).await?;
    if let Some(config_parent) = config_path.parent() {
        if !paths::paths_refer_to_same_location(config_parent, &base_dir) {
            crate::commands::openclaw_state_dir::verify_node_state_directory(
                node_path,
                config_parent,
            )
            .await?;
        }
    }

    // Do not stop a healthy selected Docker runtime until Node.js and the
    // state-directory capability probe have passed. This keeps a failed Native
    // repair from taking the working Docker Gateway offline.
    if crate::commands::docker::release_managed_docker_gateway_for_native(port).await? {
        state.transition(
            Some(GatewayLifecycle::Stopped),
            Some(GatewayRuntimeMode::None),
            None,
            "start_gateway: stopped selected Docker container before Native start",
        );
    }

    // Native mode always binds to loopback for security — never expose to LAN.
    let bind = "loopback".to_string();
    // Do not create or rewrite Gateway configuration until the selected state
    // directory has passed the authoritative Node.js probe above.
    let token = ensure_config_with_token(&config_path, port, &bind)?;
    let runtime = crate::commands::system::native_openclaw_runtime(openclaw, &node)?;
    let gw_path = augmented_path();

    // Take one bounded ownership snapshot. A missing/unreachable official
    // service is a normal foreground-start condition; it must not be queried
    // again or turned into a hard failure before `gateway run` is spawned.
    let service_identity = crate::commands::gateway_service::GatewayServiceIdentity::for_runtime(
        &base_dir,
        &config_path,
        &runtime,
    );
    let service_inspection =
        match crate::commands::gateway_service::inspect_gateway_service_state_for_start(
            &runtime,
            &service_identity,
            Some(&gw_path),
        )
        .await
        {
            Ok(inspection) => Some(inspection),
            Err(error) => {
                let message =
                    format!("Gateway service inspection skipped before foreground start: {error}");
                let _ = app.emit("gateway-log", &message);
                crate::state::gateway_process::push_log(
                    &state.logs,
                    crate::state::gateway_process::LogSource::Lifecycle,
                    crate::state::gateway_process::LogLevel::Warn,
                    message,
                );
                None
            }
        };

    // A service installed before Gateway locale was persisted can still be
    // healthy while returning the wrong wizard language. Reconcile only a
    // service proven to own JunQi's selected state/config; foreign and remote
    // Gateways remain untouched and keep their own language.
    if let Some(inspection) = service_inspection {
        if inspection.installed
            && inspection.ownership
                == crate::commands::gateway_service::GatewayServiceOwnership::StaleLocale
        {
            if inspection.running {
                crate::commands::gateway_service::stop_selected_gateway_service_verified(
                    &runtime,
                    &base_dir,
                    &config_path,
                    Some(&gw_path),
                    inspection,
                )
                .await?;
                crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await?;
            }
            crate::commands::gateway_service::rebind_selected_gateway_service(
                &runtime,
                &base_dir,
                &config_path,
                port,
                inspection.running,
                Some(&gw_path),
            )
            .await
            .map_err(|error| format!("Failed to align Gateway service locale: {error}"))?;
            if inspection.running {
                if !wait_for_selected_gateway(port, &config_path, 45).await {
                    return Err(format!(
                        "Gateway service locale was aligned, but the service did not become ready on port {}",
                        port
                    ));
                }
                *state.port.lock().map_err(|e| e.to_string())? = port;
                state.transition(
                    Some(GatewayLifecycle::Running),
                    Some(GatewayRuntimeMode::SystemService),
                    None,
                    "start_gateway: aligned selected Gateway service locale",
                );
                return Ok(GatewayStatus {
                    running: true,
                    port,
                    pid: None,
                    token: token.clone(),
                });
            }
        }
    }

    // `/healthz` proves an OpenClaw process is alive, but does not prove it
    // belongs to JunQi's selected state/config pair. Confirm the configured
    // bearer token before attaching to an external process on the shared port.
    if is_gateway_healthy(port).await {
        if !gateway_matches_config(port, &config_path).await {
            return Err(format!(
                "A healthy OpenClaw Gateway is already listening on port {}, but it does not accept the token from JunQi's selected state directory {}. It likely uses another OpenClaw state directory. Stop or reconfigure that Gateway, or select the directory it already uses.",
                port,
                base_dir.display(),
            ));
        }
        *state.port.lock().map_err(|e| e.to_string())? = port;
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(GatewayRuntimeMode::External),
            None,
            "start_gateway: authenticated existing endpoint",
        );
        return Ok(GatewayStatus {
            running: true,
            port,
            pid: None,
            token: token.clone(),
        });
    }

    // A non-Gateway process on the configured port cannot be recovered by
    // spawning another child. Report the collision before replacing an owned
    // child, so the user gets an actionable diagnosis instead of a timeout.
    if !crate::commands::gateway_supervisor::is_port_available(port).await {
        return Err(format!(
            "Port {} is occupied by a process that is not a healthy OpenClaw Gateway. Stop that process or choose another Gateway port, then retry.",
            port
        ));
    }

    // Nothing is serving — (re)start our own managed child. We only ever kill
    // our OWN previously-spawned child here, never a foreign process.
    state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Starting),
        None,
        None,
        "start_gateway: beginning spawn sequence",
    );
    #[derive(Clone, Copy)]
    enum GatewayStartStage {
        Preparation,
        OwnedChild,
        StateDirectory,
        ServiceRebind,
        Spawn,
        Readiness,
    }
    impl GatewayStartStage {
        fn failure_reason(self) -> &'static str {
            match self {
                Self::Preparation | Self::OwnedChild => "start_gateway: startup preparation failed",
                Self::StateDirectory => "start_gateway: state-directory probe failed",
                Self::ServiceRebind => "start_gateway: service rebind failed",
                Self::Spawn => "start_gateway: spawn failed",
                Self::Readiness => "start_gateway: readiness failed",
            }
        }
    }
    struct StartFailureGuard<'a> {
        state: &'a GatewayProcess,
        stage: GatewayStartStage,
        armed: bool,
    }
    impl StartFailureGuard<'_> {
        fn stage(&mut self, stage: GatewayStartStage) {
            self.stage = stage;
        }

        fn disarm(&mut self) {
            self.armed = false;
        }
    }
    impl Drop for StartFailureGuard<'_> {
        fn drop(&mut self) {
            if self.armed {
                self.state.transition(
                    Some(GatewayLifecycle::Error),
                    None,
                    None,
                    self.stage.failure_reason(),
                );
            }
        }
    }
    let mut start_failure_guard = StartFailureGuard {
        state: &state,
        stage: GatewayStartStage::Preparation,
        armed: true,
    };
    start_failure_guard.stage(GatewayStartStage::OwnedChild);
    let old_child = {
        let mut lock = state.child.lock().map_err(|e| e.to_string())?;
        lock.take()
    };
    if let Some(mut old) = old_child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut old).await;
        let _ = app.emit(
            "gateway-log",
            "Waiting for the previous Gateway process to release its port...",
        );
        crate::state::gateway_process::push_log(
            &state.logs,
            crate::state::gateway_process::LogSource::Lifecycle,
            crate::state::gateway_process::LogLevel::Info,
            "start_gateway: waiting for previous owned child's port to free".to_string(),
        );
        // Handles TCP TIME_WAIT on Windows and delayed process teardown.
        if let Err(error) =
            crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
        {
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "start_gateway: owned child terminated but port remained occupied",
            );
            start_failure_guard.disarm();
            return Err(format!(
                "Gateway process was terminated, but port {} did not become available: {}",
                port, error
            ));
        }
    }

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
    // State/config locations are passed through the command environment. The
    // process cwd is deliberately independent, but OpenClaw still needs a
    // filesystem that supports its credential-permission tightening.
    start_failure_guard.stage(GatewayStartStage::StateDirectory);
    std::fs::create_dir_all(&base_dir)
        .map_err(|error| format!("Failed to create OpenClaw state directory: {error}"))?;
    if let Some(probe_node) = crate::commands::state_dir_probe::probe_node_path(&node) {
        let _ = app.emit(
            "gateway-log",
            "Checking state directory write capability...",
        );
        crate::state::gateway_process::push_log(
            &state.logs,
            crate::state::gateway_process::LogSource::Lifecycle,
            crate::state::gateway_process::LogLevel::Info,
            "start_gateway: probing state directory chmod capability".to_string(),
        );
        match crate::commands::state_dir_probe::probe_chmod_capability(&probe_node, &base_dir).await
        {
            crate::commands::state_dir_probe::ChmodProbeOutcome::Unsupported(detail) => {
                let message = crate::commands::state_dir_probe::chmod_unsupported_message(
                    &base_dir, &detail,
                );
                let _ = app.emit("gateway-log", &message);
                crate::state::gateway_process::push_log(
                    &state.logs,
                    crate::state::gateway_process::LogSource::Lifecycle,
                    crate::state::gateway_process::LogLevel::Error,
                    message.clone(),
                );
                return Err(message);
            }
            // The probe itself failed to run (Node timed out, spawn error)
            // rather than proving the directory unusable. This must not block
            // startup — the Gateway readiness check below is authoritative —
            // but it must not be silent either, or a slow/AV-scanned probe
            // looks identical to "nothing happened" from the activity log.
            crate::commands::state_dir_probe::ChmodProbeOutcome::Inconclusive(detail) => {
                let message = format!(
                    "State directory write capability probe was inconclusive ({detail}); continuing, the Gateway readiness check will catch any real problem"
                );
                let _ = app.emit("gateway-log", &message);
                crate::state::gateway_process::push_log(
                    &state.logs,
                    crate::state::gateway_process::LogSource::Lifecycle,
                    crate::state::gateway_process::LogLevel::Warn,
                    message,
                );
            }
            crate::commands::state_dir_probe::ChmodProbeOutcome::Supported => {}
        }
    }
    let pending_service_running = paths::pending_gateway_service_rebind();
    if let Some(was_running) = pending_service_running {
        start_failure_guard.stage(GatewayStartStage::ServiceRebind);
        // A mode switch or storage migration may have stopped an official
        // service before committing the new Native paths. Reconcile it at the
        // common start boundary as well as in the setup guide, so a direct
        // restart cannot leave a Scheduled Task pointing at stale Node/npm
        // or config locations.
        crate::commands::gateway_service::reconcile_pending_gateway_service(
            &runtime,
            &base_dir,
            &config_path,
            port,
            Some(&gw_path),
        )
        .await?;
        if was_running {
            if !wait_for_selected_gateway(port, &config_path, 45).await {
                return Err(format!(
                    "Rebound OpenClaw Gateway service did not become ready on port {}",
                    port
                ));
            }
            state.transition(
                Some(GatewayLifecycle::Running),
                Some(GatewayRuntimeMode::SystemService),
                None,
                "start_gateway: rebound official Gateway service is healthy",
            );
            return Ok(GatewayStatus {
                running: true,
                port,
                pid: None,
                token: token.clone(),
            });
        }
    } else if let Some(inspection) = service_inspection {
        if stop_offline_gateway_service(
            &app,
            &runtime,
            &base_dir,
            &config_path,
            &gw_path,
            inspection,
        )
        .await?
        {
            state.transition(
                Some(GatewayLifecycle::Stopped),
                Some(GatewayRuntimeMode::None),
                None,
                "start_gateway: stopped competing offline system service",
            );
        }
    }

    // Inject env.vars into the gateway process so providers that rely on
    // process-level environment variables (e.g. OPENAI_API_KEY) receive them
    // even when configured via the UI rather than the user's shell profile.
    // ConfigMetadata already parsed env.vars above — no additional disk IO here.
    let extra_env_vars = meta.env_vars;

    start_failure_guard.stage(GatewayStartStage::Spawn);
    let context = crate::commands::system::OpenclawCommandContext::managed_gateway(
        base_dir.clone(),
        config_path.clone(),
    )
    .with_search_path(gw_path);
    let mut cmd = runtime.command(&context);
    cmd.args([
        "gateway",
        "run",
        "--bind",
        &bind,
        "--port",
        &port.to_string(),
    ]);
    for (k, v) in &extra_env_vars {
        cmd.env(k, v);
    }
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let startup_started_at_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let mut child = cmd.spawn().map_err(|e| {
        // Diagnose common failure modes. Pre-fix: just returned the raw
        // io::Error which was opaque to the user.
        if e.kind() == std::io::ErrorKind::NotFound {
            format!(
                "openclaw could not be launched from the resolved runtime (current PATH={:?}). \
                 Ensure the npm executable directory that owns this OpenClaw installation is on PATH, \
                 then retry setup. Underlying error: {}",
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

    // A spawned process is not yet a running Gateway. Keep ownership local
    // until either its TCP endpoint is reachable, the child exits, or startup
    // times out. This gives every caller one cross-platform readiness contract
    // and preserves the real stderr instead of reducing failures to a UI timer.
    let startup_started_at = std::time::Instant::now();
    let startup_deadline =
        startup_started_at + std::time::Duration::from_secs(MANAGED_GATEWAY_START_TIMEOUT_SECS);
    let mut next_heartbeat_at =
        startup_started_at + std::time::Duration::from_secs(MANAGED_GATEWAY_START_HEARTBEAT_SECS);
    start_failure_guard.stage(GatewayStartStage::Readiness);
    loop {
        let now = std::time::Instant::now();
        if now >= next_heartbeat_at {
            let elapsed = now.duration_since(startup_started_at).as_secs();
            let _ = app.emit(
                "gateway-log",
                format!(
                    "Still waiting for the Gateway to become reachable on 127.0.0.1:{} (elapsed {}s)...",
                    port, elapsed
                ),
            );
            next_heartbeat_at = now + std::time::Duration::from_secs(MANAGED_GATEWAY_START_HEARTBEAT_SECS);
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // Let the async stdout/stderr readers flush their final lines.
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let msg = with_managed_gateway_diagnostics(
                    format!("Gateway exited before becoming ready ({})", status),
                    &state,
                    startup_started_at_ms,
                );
                let _ = app.emit("gateway-log", &msg);
                return Err(msg);
            }
            Ok(None) => {}
            Err(error) => {
                crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
                return Err(format!("Failed to check Gateway process status: {}", error));
            }
        }

        if gateway_matches_config(port, &config_path).await {
            break;
        }

        if std::time::Instant::now() >= startup_deadline {
            crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
            let _ = crate::commands::gateway_supervisor::wait_for_port_free(port, 5_000).await;
            let msg = with_managed_gateway_diagnostics(
                format!(
                    "Gateway process did not become reachable on 127.0.0.1:{} within {} seconds",
                    port, MANAGED_GATEWAY_START_TIMEOUT_SECS
                ),
                &state,
                startup_started_at_ms,
            );
            let _ = app.emit("gateway-log", &msg);
            return Err(msg);
        }

        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
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
        "start_gateway: managed child health check passed",
    );
    start_failure_guard.disarm();

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
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    let child = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        child_lock.take()
    };

    if let Some(mut child) = child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
        crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000)
            .await
            .map_err(|error| {
                state.transition(
                    Some(GatewayLifecycle::Error),
                    Some(GatewayRuntimeMode::None),
                    None,
                    "stop_gateway: owned child terminated but port remained occupied",
                );
                format!(
                    "Gateway process was terminated, but port {} did not become available: {}",
                    port, error
                )
            })?;
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
    let config_path = paths::active_config_path();
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
        if gateway_matches_config(port, &config_path).await {
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
    if gateway_matches_config(port, &config_path).await {
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
        None => ConfigMetadata::load(&paths::active_config_path()).port,
    };
    Ok(is_gateway_healthy(target_port).await)
}

/// Probe the selected runtime's authenticated Gateway identity, not just a
/// TCP listener. This is the readiness contract used by onboarding and
/// migration so another process on the same port cannot satisfy the flow.
#[tauri::command]
pub async fn probe_selected_gateway(port: Option<u16>) -> Result<bool, String> {
    let config_path = paths::active_config_path();
    let target_port = match port {
        Some(port) => port,
        None => ConfigMetadata::load(&config_path).port,
    };
    Ok(gateway_matches_config(target_port, &config_path).await)
}
