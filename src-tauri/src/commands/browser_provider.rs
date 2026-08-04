//! Discovery and handoff for browser runtimes that can be used by JunQi.
//!
//! OpenClaw's managed browser is owned by the Gateway and is therefore
//! reported by the renderer from `tools.effective`. The optional ego-lite
//! integration is intentionally a handoff: JunQi discovers the official CLI,
//! opens only the known ego lite application paths, and leaves installation,
//! onboarding, and Chrome-data migration to the upstream application.

use serde::Serialize;
use std::path::PathBuf;

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
    application_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum BrowserProviderStatus {
    Available,
    NotInstalled,
    Unsupported,
}

const EGO_LITE_APPLICATION_NAME: &str = "ego lite.app";

fn ego_lite_application_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from("/Applications").join(EGO_LITE_APPLICATION_NAME)];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(
            PathBuf::from(home)
                .join("Applications")
                .join(EGO_LITE_APPLICATION_NAME),
        );
    }
    candidates
}

fn find_ego_lite_application() -> Option<PathBuf> {
    ego_lite_application_candidates()
        .into_iter()
        .find(|candidate| candidate.is_dir())
}

/// Discover optional browser providers without launching them.
///
/// The official ego-lite skill currently documents macOS as its supported
/// platform. Keeping that gate in the native probe prevents the UI from
/// presenting a runnable provider on platforms where the upstream app is not
/// available yet. The command lookup and app-path discovery remain centralized
/// here so a future platform support change only needs one contract update.
#[tauri::command]
pub fn probe_browser_providers() -> Vec<BrowserProviderCapability> {
    let platform = std::env::consts::OS.to_string();
    let platform_supported = cfg!(target_os = "macos");
    let path = crate::platform::detect_path(EGO_BROWSER_BINARY);
    let executable_path = (!path.is_empty()).then_some(path);
    let application_path = platform_supported
        .then(find_ego_lite_application)
        .flatten()
        .map(|path| path.to_string_lossy().into_owned());
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
        application_path,
    }]
}

/// Open the installed upstream application without invoking a shell.
///
/// Installation, onboarding, and the optional Chrome-data import remain inside
/// ego lite. This command is deliberately limited to the two documented
/// per-machine application locations and never accepts a renderer-provided
/// path.
#[tauri::command]
pub fn open_ego_lite() -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("ego-lite is currently supported on macOS only".to_string());
    }

    let application = find_ego_lite_application()
        .ok_or_else(|| "ego lite application is not installed".to_string())?;
    open::that(&application).map_err(|error| format!("failed to open ego lite: {error}"))
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::{
        ego_lite_application_candidates, EGO_BROWSER_BINARY, EGO_LITE_APPLICATION_NAME,
        EGO_LITE_PROVIDER_ID,
    };

    #[test]
    fn ego_provider_uses_the_official_cli_identity() {
        assert_eq!(EGO_LITE_PROVIDER_ID, "ego-lite");
        assert_eq!(EGO_BROWSER_BINARY, "ego-browser");
        assert_eq!(EGO_LITE_APPLICATION_NAME, "ego lite.app");
    }

    #[test]
    fn application_candidates_are_fixed_to_known_locations() {
        let candidates = ego_lite_application_candidates();
        let system_application = PathBuf::from("/Applications").join(EGO_LITE_APPLICATION_NAME);
        assert!(candidates.contains(&system_application));
        assert!(candidates.iter().all(|candidate| {
            candidate.file_name().and_then(|name| name.to_str()) == Some(EGO_LITE_APPLICATION_NAME)
        }));
    }
}
