use crate::commands::openclaw_cli;
use std::time::Duration;

const DEVICE_APPROVAL_TIMEOUT: Duration = Duration::from_secs(30);

/// Approve one exact pending device request through the selected OpenClaw
/// runtime. The renderer must obtain explicit user confirmation before calling
/// this command. OpenClaw remains the authority for request identity, scope
/// changes, replacement requests, and approval persistence.
#[tauri::command]
pub async fn approve_selected_gateway_device(request_id: String) -> Result<(), String> {
    let request_id = request_id.trim();
    openclaw_cli::validate_cli_identifier(request_id, "device pairing request id")?;

    let output = openclaw_cli::run_openclaw(
        &["devices", "approve", request_id],
        None,
        DEVICE_APPROVAL_TIMEOUT,
    )
    .await?;
    if output.success {
        return Ok(());
    }

    Err(openclaw_cli::output_error("device approval", &output))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_id_validation_rejects_argument_injection() {
        assert!(openclaw_cli::validate_cli_identifier(
            "014cc8c1-17cc-4a68-b255-789bd8d73386",
            "device pairing request id"
        )
        .is_ok());
        assert!(openclaw_cli::validate_cli_identifier(
            "request-id --latest",
            "device pairing request id"
        )
        .is_err());
    }
}
