//! Non-GUI cleanup invoked by the Windows NSIS uninstaller.
//!
//! This module deliberately has a narrow ownership boundary. It removes only
//! JunQi-created terminal integration and an official Gateway service whose
//! state/config identity matches the persisted JunQi layout. User data and
//! dependency installations remain untouched.

use crate::{commands::gateway_service, paths};

const CLEANUP_ARGUMENT: &str = "--junqi-uninstall-cleanup";

pub(crate) fn requested() -> bool {
    std::env::args().any(|argument| argument == CLEANUP_ARGUMENT)
}

pub(crate) fn run() -> Result<(), String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to initialize uninstall cleanup runtime: {error}"))?
        .block_on(run_async())
}

async fn run_async() -> Result<(), String> {
    let mut errors = Vec::new();

    // This operation is independent of the OpenClaw runtime and remains safe
    // even when a migration is pending or the user's Node/npm has been removed.
    if let Err(error) =
        crate::commands::terminal_integration::disable_terminal_integration_for_uninstall()
    {
        errors.push(format!("remove JunQi terminal integration: {error}"));
    }

    // Without a persisted JunQi layout there is no ownership record. A user's
    // default OpenClaw service must never be treated as an app-owned service
    // merely because it happens to use ~/.openclaw.
    let Some(layout) = paths::load_storage_bootstrap() else {
        return finish(errors);
    };

    let binary = crate::commands::system::resolve_openclaw_binary_async().await;
    let Some(binary) = binary else {
        return finish_with_runtime_note(
            errors,
            "OpenClaw runtime could not be resolved; the official Gateway service was left untouched",
        );
    };
    let runtime = match crate::commands::system::compatible_native_openclaw_runtime(binary).await {
        Ok(runtime) => runtime,
        Err(error) => {
            return finish_with_runtime_note(
                errors,
                &format!(
                    "OpenClaw runtime is unavailable ({error}); the official Gateway service was left untouched"
                ),
            );
        }
    };
    let search_path = crate::commands::system::openclaw_search_path();
    match gateway_service::uninstall_selected_gateway_service(
        &runtime,
        &layout.state_dir,
        &layout.config_path,
        Some(&search_path),
    )
    .await
    {
        Ok(true) | Ok(false) => {}
        Err(error) => errors.push(format!("remove JunQi Gateway service: {error}")),
    }

    finish(errors)
}

fn finish_with_runtime_note(mut errors: Vec<String>, note: &str) -> Result<(), String> {
    errors.push(note.to_string());
    finish(errors)
}

fn finish(errors: Vec<String>) -> Result<(), String> {
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleanup_argument_is_explicit() {
        assert_eq!(CLEANUP_ARGUMENT, "--junqi-uninstall-cleanup");
    }
}
