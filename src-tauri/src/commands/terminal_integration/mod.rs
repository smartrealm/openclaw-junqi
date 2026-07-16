use crate::paths;
use serde::Serialize;
use std::marker::PhantomData;
use std::path::{Path, PathBuf};

#[cfg(not(windows))]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(not(windows))]
use unix::UnixBackend as ActiveBackend;
#[cfg(windows)]
use windows::WindowsBackend as ActiveBackend;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalIntegrationStatus {
    pub requested: bool,
    pub enabled: bool,
    pub launcher_ready: bool,
    pub launcher_dir: String,
    pub launcher_path: String,
    pub profile_path: Option<String>,
    pub terminal_restart_required: bool,
    pub message: String,
}

#[derive(Debug, Default)]
struct EnvironmentBinding {
    profile_path: Option<PathBuf>,
}

/// The launcher is generated from the selected runtime rather than from the
/// accidental presence of a host-side OpenClaw binary. This keeps Docker
/// terminal integration useful on a clean Docker-only installation.
pub(super) enum TerminalLauncherTarget<'a> {
    Native(Option<&'a Path>),
    Docker,
}

trait TerminalIntegrationBackend {
    const LAUNCHER_FILENAME: &'static str;

    fn apply_environment(enabled: bool) -> Result<EnvironmentBinding, String>;
    fn detect_environment() -> EnvironmentBinding;
    fn is_environment_configured(binding: &EnvironmentBinding) -> bool;
    fn launcher_contents(target: TerminalLauncherTarget<'_>) -> String;

    fn prepare_launcher(_path: &Path) -> Result<(), String> {
        Ok(())
    }
}

struct TerminalIntegrationService<B>(PhantomData<B>);

impl<B: TerminalIntegrationBackend> TerminalIntegrationService<B> {
    fn launcher_path() -> PathBuf {
        paths::terminal_launcher_dir().join(B::LAUNCHER_FILENAME)
    }

    fn sync(
        requested: bool,
        native_binary_override: Option<&Path>,
    ) -> Result<TerminalIntegrationStatus, String> {
        let binding = if requested {
            let runtime = paths::active_runtime_mode();
            let detected_binary = matches!(runtime, paths::OpenClawRuntimeMode::Native)
                .then(crate::commands::system::resolve_openclaw_binary)
                .flatten();
            let binary = native_binary_override.or(detected_binary.as_deref());
            let target = match runtime {
                paths::OpenClawRuntimeMode::Native => TerminalLauncherTarget::Native(binary),
                paths::OpenClawRuntimeMode::Docker => TerminalLauncherTarget::Docker,
            };
            Self::write_launcher(target)?;
            B::apply_environment(true)?
        } else {
            let binding = B::apply_environment(false)?;
            Self::remove_launcher()?;
            binding
        };
        Ok(Self::build_status(requested, binding))
    }

    fn detect(requested: bool) -> TerminalIntegrationStatus {
        Self::build_status(requested, B::detect_environment())
    }

    fn write_launcher(target: TerminalLauncherTarget<'_>) -> Result<(), String> {
        let directory = paths::terminal_launcher_dir();
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create terminal launcher directory: {}", error))?;
        let path = Self::launcher_path();
        paths::atomic_write_text(&path, &B::launcher_contents(target))?;
        B::prepare_launcher(&path)
    }

    fn remove_launcher() -> Result<(), String> {
        let path = Self::launcher_path();
        if !path.exists() {
            return Ok(());
        }
        std::fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove terminal launcher: {}", error))
    }

    fn build_status(requested: bool, binding: EnvironmentBinding) -> TerminalIntegrationStatus {
        let launcher = Self::launcher_path();
        let enabled = requested && launcher.is_file() && B::is_environment_configured(&binding);
        let current_path_has_launcher = current_path_contains(&paths::terminal_launcher_dir());
        let runtime_ready = match paths::active_runtime_mode() {
            paths::OpenClawRuntimeMode::Native => {
                crate::commands::system::resolve_openclaw_binary().is_some()
            }
            paths::OpenClawRuntimeMode::Docker => true,
        };
        TerminalIntegrationStatus {
            requested,
            enabled,
            launcher_ready: launcher.is_file() && runtime_ready,
            launcher_dir: paths::terminal_launcher_dir().to_string_lossy().to_string(),
            launcher_path: launcher.to_string_lossy().to_string(),
            profile_path: binding
                .profile_path
                .map(|path| path.to_string_lossy().to_string()),
            terminal_restart_required: enabled && !current_path_has_launcher,
            message: status_message(requested, enabled, current_path_has_launcher),
        }
    }
}

fn status_message(requested: bool, enabled: bool, active_in_process: bool) -> String {
    match (requested, enabled, active_in_process) {
        (_, true, true) => "Terminal integration is active",
        (_, true, false) => "Terminal integration is configured; open a new terminal to use it",
        (true, false, _) => "Terminal integration is pending",
        (false, false, _) => "Terminal integration is disabled",
    }
    .into()
}

fn current_path_contains(expected: &Path) -> bool {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .any(|entry| path_entries_equal(&entry, expected))
}

fn path_entries_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

#[cfg(any(windows, test))]
fn updated_windows_path(current: &str, launcher: &str, enabled: bool) -> String {
    let mut entries = current
        .split(';')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .filter(|entry| !entry.eq_ignore_ascii_case(launcher))
        .map(str::to_string)
        .collect::<Vec<_>>();
    if enabled {
        entries.insert(0, launcher.to_string());
    }
    entries.join(";")
}

pub(crate) fn sync_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    if matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        crate::commands::system::ensure_openclaw_relocation_complete()?;
    }
    TerminalIntegrationService::<ActiveBackend>::sync(paths::terminal_integration_requested(), None)
}

/// Sync against the binary already validated by a relocation. The normal
/// resolver deliberately hides binaries until the relocation is committed.
pub(crate) fn sync_terminal_integration_for_relocation(
    binary: &Path,
) -> Result<TerminalIntegrationStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Err("OpenClaw relocation terminal sync requires the Native runtime".into());
    }
    TerminalIntegrationService::<ActiveBackend>::sync(
        paths::terminal_integration_requested(),
        Some(binary),
    )
}

#[tauri::command]
pub async fn apply_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    sync_terminal_integration()
}

#[tauri::command]
pub async fn get_terminal_integration_status() -> Result<TerminalIntegrationStatus, String> {
    Ok(TerminalIntegrationService::<ActiveBackend>::detect(
        paths::terminal_integration_requested(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_path_update_is_case_insensitive_and_idempotent() {
        let current = r"C:\Windows;C:\Users\Wei\JunQi\bin;%USERPROFILE%\bin";
        let launcher = r"c:\users\wei\junqi\BIN";

        let enabled = updated_windows_path(current, launcher, true);
        assert_eq!(
            enabled,
            r"c:\users\wei\junqi\BIN;C:\Windows;%USERPROFILE%\bin"
        );
        assert_eq!(updated_windows_path(&enabled, launcher, true), enabled);
        assert_eq!(
            updated_windows_path(&enabled, launcher, false),
            r"C:\Windows;%USERPROFILE%\bin"
        );
    }

    #[test]
    fn status_messages_cover_each_state_without_nested_branches() {
        assert_eq!(
            status_message(false, false, false),
            "Terminal integration is disabled"
        );
        assert_eq!(
            status_message(true, false, false),
            "Terminal integration is pending"
        );
        assert_eq!(
            status_message(true, true, true),
            "Terminal integration is active"
        );
        assert!(status_message(true, true, false).contains("open a new terminal"));
    }
}
