//! Read-only discovery for browser runtimes that can be used by JunQi.
//!
//! OpenClaw's managed browser is owned by the Gateway and is therefore
//! reported by the renderer from `tools.effective`. This command only probes
//! the optional external ego-lite CLI. It never starts a browser, migrates
//! profile data, or executes an untrusted install command.

use serde::Serialize;

const EGO_LITE_PROVIDER_ID: &str = "ego-lite";
const EGO_BROWSER_BINARY: &str = "ego-browser";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserProviderCapability {
    provider_id: String,
    status: BrowserProviderStatus,
    platform: String,
    platform_supported: bool,
    executable_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum BrowserProviderStatus {
    Available,
    NotInstalled,
    Unsupported,
}

/// Discover optional browser providers without launching them.
///
/// The official ego-lite skill currently documents macOS as its supported
/// platform. Keeping that gate in the native probe prevents the UI from
/// presenting a runnable provider on platforms where the upstream app is not
/// available yet. The command lookup still remains centralized here so a
/// future platform support change only needs one contract update.
#[tauri::command]
pub fn probe_browser_providers() -> Vec<BrowserProviderCapability> {
    let platform = std::env::consts::OS.to_string();
    let platform_supported = cfg!(target_os = "macos");
    let path = crate::platform::detect_path(EGO_BROWSER_BINARY);
    let executable_path = (!path.is_empty()).then_some(path);
    let status = if !platform_supported {
        BrowserProviderStatus::Unsupported
    } else if executable_path.is_some() {
        BrowserProviderStatus::Available
    } else {
        BrowserProviderStatus::NotInstalled
    };

    vec![BrowserProviderCapability {
        provider_id: EGO_LITE_PROVIDER_ID.to_string(),
        status,
        platform,
        platform_supported,
        executable_path,
    }]
}

#[cfg(test)]
mod tests {
    use super::{EGO_BROWSER_BINARY, EGO_LITE_PROVIDER_ID};

    #[test]
    fn ego_provider_uses_the_official_cli_identity() {
        assert_eq!(EGO_LITE_PROVIDER_ID, "ego-lite");
        assert_eq!(EGO_BROWSER_BINARY, "ego-browser");
    }
}
