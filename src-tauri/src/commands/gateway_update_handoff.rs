//! Gateway ownership handoff for native OpenClaw package updates.
//!
//! Replacing a global npm package beneath a running Node.js process is unsafe:
//! a long-lived Gateway can later resolve a lazy module from the new package
//! tree while still holding the old module graph in memory. This module makes
//! the owner explicit, stops only a verified owner, and restores the same
//! owner after the replacement has passed runtime validation.

use crate::commands::{gateway, gateway_service, gateway_supervisor, system};
use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use std::path::PathBuf;
use tauri::{AppHandle, State};

const GATEWAY_HANDOFF_PORT_RELEASE_TIMEOUT_MS: u64 = 30_000;
const GATEWAY_HANDOFF_READY_TIMEOUT_SECS: u64 = 45;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GatewayUpdateOwner {
    NoRunningGateway,
    ManagedChild,
    SelectedService { was_running: bool },
}

/// A prepared, single-owner Gateway transaction around a package replacement.
///
/// `prepare` is called after the updater has completed all network and Node.js
/// preflight. It either stops the one verified owner or returns an error before
/// any package mutation occurs. `restore` accepts only a validated runtime.
pub(crate) struct GatewayUpdateHandoff {
    owner: GatewayUpdateOwner,
    port: u16,
    state_dir: PathBuf,
    config_path: PathBuf,
    search_path: String,
}

impl GatewayUpdateHandoff {
    pub(crate) async fn prepare(
        state: &GatewayProcess,
        runtime: &system::NativeOpenclawRuntime,
    ) -> Result<Self, String> {
        let state_dir = paths::desktop_dir();
        let config_path = paths::config_path();
        let port = gateway::configured_gateway_port();
        let search_path = system::openclaw_search_path();
        let identity =
            gateway_service::GatewayServiceIdentity::for_runtime(&state_dir, &config_path, runtime);
        let inspection = gateway_service::inspect_gateway_service_state(
            runtime,
            &identity,
            Some(&search_path),
        )
        .await
        .map_err(|error| {
            format!(
                "Could not verify the OpenClaw Gateway service before updating: {error}. The package was not changed."
            )
        })?;
        let managed_child_running = tracked_managed_child_is_running(state)?;
        let endpoint_matches_config = gateway::gateway_matches_config(port, &config_path).await;
        let owner =
            plan_gateway_update_owner(managed_child_running, endpoint_matches_config, inspection)?;
        let handoff = Self {
            owner,
            port,
            state_dir,
            config_path,
            search_path,
        };
        handoff.stop_active_owner(state, runtime).await?;
        Ok(handoff)
    }

    pub(crate) fn requires_running_gateway_restore(&self) -> bool {
        matches!(
            self.owner,
            GatewayUpdateOwner::ManagedChild
                | GatewayUpdateOwner::SelectedService { was_running: true }
        )
    }

    /// Restore the previous owner only after the installed package has passed
    /// metadata, inventory, and executable validation.
    pub(crate) async fn restore(
        &self,
        app: AppHandle,
        state: State<'_, GatewayProcess>,
        runtime: &system::NativeOpenclawRuntime,
    ) -> Result<bool, String> {
        match self.owner {
            GatewayUpdateOwner::NoRunningGateway => Ok(false),
            GatewayUpdateOwner::ManagedChild => self.restore_managed_child(app, state).await,
            GatewayUpdateOwner::SelectedService { was_running } => {
                self.restore_selected_service(state, runtime, was_running)
                    .await
            }
        }
    }

    /// Clear the transient restart state when no valid runtime exists to
    /// restore. A package update that cannot be validated must never restart a
    /// potentially partial package merely to hide the update error.
    pub(crate) fn mark_unrecoverable_failure(&self, state: &GatewayProcess, reason: &str) {
        if self.requires_running_gateway_restore() {
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                Some(false),
                reason,
            );
        }
    }

    async fn stop_active_owner(
        &self,
        state: &GatewayProcess,
        runtime: &system::NativeOpenclawRuntime,
    ) -> Result<(), String> {
        match self.owner {
            GatewayUpdateOwner::NoRunningGateway
            | GatewayUpdateOwner::SelectedService { was_running: false } => Ok(()),
            GatewayUpdateOwner::ManagedChild => {
                state.transition(
                    Some(GatewayLifecycle::Reconnecting),
                    Some(GatewayRuntimeMode::ManagedChild),
                    Some(true),
                    "openclaw_update: stopping desktop-managed Gateway before package replacement",
                );
                let child = state
                    .child
                    .lock()
                    .map_err(|error| error.to_string())?
                    .take()
                    .ok_or_else(|| {
                        "The tracked desktop-managed Gateway exited before the update handoff began"
                            .to_string()
                    })?;
                let mut child = child;
                gateway_supervisor::terminate_owned_gateway(&mut child).await;
                self.wait_for_port_release(state, "desktop-managed Gateway")
                    .await
            }
            GatewayUpdateOwner::SelectedService { was_running: true } => {
                state.transition(
                    Some(GatewayLifecycle::Reconnecting),
                    Some(GatewayRuntimeMode::SystemService),
                    Some(true),
                    "openclaw_update: stopping selected Gateway service before package replacement",
                );
                let stopped = gateway_service::stop_selected_gateway_service(
                    runtime,
                    &self.state_dir,
                    &self.config_path,
                    Some(&self.search_path),
                )
                .await
                .map_err(|error| {
                    self.mark_unrecoverable_failure(
                        state,
                        "openclaw_update: selected Gateway service stop failed before package replacement",
                    );
                    format!(
                        "Could not stop the selected OpenClaw Gateway service before updating: {error}. The package was not changed."
                    )
                })?;
                if !stopped {
                    self.mark_unrecoverable_failure(
                        state,
                        "openclaw_update: selected Gateway service changed before package replacement",
                    );
                    return Err(
                        "The selected OpenClaw Gateway service changed before it could be stopped; the package was not changed"
                            .into(),
                    );
                }
                self.wait_for_port_release(state, "selected Gateway service")
                    .await
            }
        }
    }

    async fn wait_for_port_release(
        &self,
        state: &GatewayProcess,
        owner_name: &str,
    ) -> Result<(), String> {
        match gateway_supervisor::wait_for_port_free(
            self.port,
            GATEWAY_HANDOFF_PORT_RELEASE_TIMEOUT_MS,
        )
        .await
        {
            Ok(_) => {
                state.transition(
                    Some(GatewayLifecycle::Stopped),
                    Some(GatewayRuntimeMode::None),
                    Some(true),
                    "openclaw_update: Gateway owner stopped before package replacement",
                );
                Ok(())
            }
            Err(error) => {
                let reason = format!(
                    "openclaw_update: {owner_name} stopped but Gateway port did not become available"
                );
                self.mark_unrecoverable_failure(state, &reason);
                Err(format!(
                    "The {owner_name} stopped, but port {} did not become available before the update: {error}. The package was not changed.",
                    self.port
                ))
            }
        }
    }

    async fn restore_managed_child(
        &self,
        app: AppHandle,
        state: State<'_, GatewayProcess>,
    ) -> Result<bool, String> {
        // `start_gateway_locked` intentionally returns early while a restart
        // flag is set. Clear the handoff marker before entering that common
        // managed-child startup path.
        state.transition(
            Some(GatewayLifecycle::Stopped),
            Some(GatewayRuntimeMode::None),
            Some(false),
            "openclaw_update: validated package; restoring desktop-managed Gateway",
        );
        match gateway::start_gateway_locked(app, state.clone(), Some(self.port)).await {
            Ok(status) if status.running => Ok(true),
            Ok(status) => {
                let error = format!(
                    "Desktop-managed Gateway recovery returned a non-running status on port {}",
                    status.port
                );
                self.mark_unrecoverable_failure(
                    &state,
                    "openclaw_update: managed Gateway recovery was not ready",
                );
                Err(error)
            }
            Err(error) => {
                self.mark_unrecoverable_failure(
                    &state,
                    "openclaw_update: managed Gateway recovery failed",
                );
                Err(format!(
                    "Failed to restore the desktop-managed Gateway: {error}"
                ))
            }
        }
    }

    async fn restore_selected_service(
        &self,
        state: State<'_, GatewayProcess>,
        runtime: &system::NativeOpenclawRuntime,
        was_running: bool,
    ) -> Result<bool, String> {
        let identity = gateway_service::GatewayServiceIdentity::for_runtime(
            &self.state_dir,
            &self.config_path,
            runtime,
        );
        let inspection = gateway_service::inspect_gateway_service_state(
            runtime,
            &identity,
            Some(&self.search_path),
        )
        .await
        .map_err(|error| {
            format!("Could not inspect the selected Gateway service after update: {error}")
        })?;
        if !inspection.installed
            || !gateway_service::belongs_to_selected_state(inspection.ownership)
        {
            self.mark_unrecoverable_failure(
                &state,
                "openclaw_update: selected Gateway service identity changed after package replacement",
            );
            return Err(
                "The selected OpenClaw Gateway service identity changed during the update; it was not restarted"
                    .into(),
            );
        }

        // A platform service can restart itself after a stop request. Verify
        // ownership again and stop only that selected service before rebind or
        // explicit start, so it never runs a mixed old/new module graph.
        if inspection.running {
            let stopped = gateway_service::stop_selected_gateway_service(
                runtime,
                &self.state_dir,
                &self.config_path,
                Some(&self.search_path),
            )
            .await?;
            if !stopped {
                self.mark_unrecoverable_failure(
                    &state,
                    "openclaw_update: selected Gateway service changed while restoring",
                );
                return Err(
                    "The selected OpenClaw Gateway service changed while the update was being restored"
                        .into(),
                );
            }
            self.wait_for_port_release(&state, "selected Gateway service")
                .await?;
        }

        if matches!(
            inspection.ownership,
            gateway_service::GatewayServiceOwnership::StaleRuntime
                | gateway_service::GatewayServiceOwnership::StaleLocale
        ) {
            gateway_service::rebind_selected_gateway_service(
                runtime,
                &self.state_dir,
                &self.config_path,
                self.port,
                false,
                Some(&self.search_path),
            )
            .await
            .map_err(|error| format!("Failed to rebind the selected Gateway service: {error}"))?;
        }

        if !was_running {
            state.transition(
                Some(GatewayLifecycle::Stopped),
                Some(GatewayRuntimeMode::None),
                Some(false),
                "openclaw_update: selected Gateway service remains stopped after update",
            );
            return Ok(false);
        }

        gateway_service::start_selected_gateway_service_with_path(
            runtime,
            &self.state_dir,
            &self.config_path,
            Some(&self.search_path),
        )
        .await
        .map_err(|error| format!("Failed to start the selected Gateway service: {error}"))?;
        if !gateway::wait_for_selected_gateway(
            self.port,
            &self.config_path,
            GATEWAY_HANDOFF_READY_TIMEOUT_SECS,
        )
        .await
        {
            self.mark_unrecoverable_failure(
                &state,
                "openclaw_update: selected Gateway service did not become ready after update",
            );
            return Err(format!(
                "The selected OpenClaw Gateway service did not become ready on port {} after the update",
                self.port
            ));
        }

        state.transition(
            Some(GatewayLifecycle::Running),
            Some(GatewayRuntimeMode::SystemService),
            Some(false),
            "openclaw_update: selected Gateway service restored after package replacement",
        );
        Ok(true)
    }
}

fn tracked_managed_child_is_running(state: &GatewayProcess) -> Result<bool, String> {
    let mut child = state.child.lock().map_err(|error| error.to_string())?;
    let Some(process) = child.as_mut() else {
        return Ok(false);
    };
    match process.try_wait() {
        Ok(None) => Ok(true),
        Ok(Some(_)) => {
            *child = None;
            Ok(false)
        }
        Err(error) => Err(format!(
            "Could not inspect the desktop-managed Gateway process before updating: {error}"
        )),
    }
}

fn plan_gateway_update_owner(
    managed_child_running: bool,
    endpoint_matches_config: bool,
    inspection: gateway_service::GatewayServiceInspection,
) -> Result<GatewayUpdateOwner, String> {
    if managed_child_running {
        if inspection.running {
            return Err(
                "JunQi found both a desktop-managed Gateway process and a running OpenClaw system service. Stop or reconcile one owner before updating OpenClaw."
                    .into(),
            );
        }
        return Ok(GatewayUpdateOwner::ManagedChild);
    }

    if inspection.running {
        if inspection.installed && gateway_service::belongs_to_selected_state(inspection.ownership)
        {
            return Ok(GatewayUpdateOwner::SelectedService { was_running: true });
        }
        return Err(
            "A running OpenClaw Gateway service could not be verified as JunQi's selected state and configuration. Stop it or explicitly take over its state before updating OpenClaw."
                .into(),
        );
    }

    if endpoint_matches_config {
        return Err(
            "An authenticated OpenClaw Gateway is running, but JunQi does not own it as a desktop process or selected system service. Stop it or explicitly take over its state before updating OpenClaw."
                .into(),
        );
    }

    if inspection.installed && gateway_service::belongs_to_selected_state(inspection.ownership) {
        return Ok(GatewayUpdateOwner::SelectedService { was_running: false });
    }

    Ok(GatewayUpdateOwner::NoRunningGateway)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::gateway_service::{GatewayServiceInspection, GatewayServiceOwnership};

    fn inspection(
        ownership: GatewayServiceOwnership,
        installed: bool,
        running: bool,
    ) -> GatewayServiceInspection {
        GatewayServiceInspection {
            ownership,
            installed,
            running,
        }
    }

    #[test]
    fn update_handoff_keeps_a_single_managed_child_owner() {
        assert_eq!(
            plan_gateway_update_owner(
                true,
                true,
                inspection(GatewayServiceOwnership::Absent, false, false),
            ),
            Ok(GatewayUpdateOwner::ManagedChild)
        );
    }

    #[test]
    fn update_handoff_preserves_selected_service_running_state() {
        assert_eq!(
            plan_gateway_update_owner(
                false,
                true,
                inspection(GatewayServiceOwnership::SelectedState, true, true),
            ),
            Ok(GatewayUpdateOwner::SelectedService { was_running: true })
        );
        assert_eq!(
            plan_gateway_update_owner(
                false,
                false,
                inspection(GatewayServiceOwnership::StaleRuntime, true, false),
            ),
            Ok(GatewayUpdateOwner::SelectedService { was_running: false })
        );
    }

    #[test]
    fn update_handoff_refuses_ambiguous_or_foreign_running_owners() {
        let duplicate = plan_gateway_update_owner(
            true,
            true,
            inspection(GatewayServiceOwnership::SelectedState, true, true),
        )
        .unwrap_err();
        assert!(duplicate.contains("both a desktop-managed Gateway"));

        let foreign = plan_gateway_update_owner(
            false,
            false,
            inspection(GatewayServiceOwnership::Foreign, true, true),
        )
        .unwrap_err();
        assert!(foreign.contains("could not be verified"));

        let external = plan_gateway_update_owner(
            false,
            true,
            inspection(GatewayServiceOwnership::Absent, false, false),
        )
        .unwrap_err();
        assert!(external.contains("authenticated OpenClaw Gateway"));
    }
}
