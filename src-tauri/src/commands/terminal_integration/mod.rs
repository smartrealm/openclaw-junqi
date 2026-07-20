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

/// The terminal launcher is an app-owned artifact, but changing it together
/// with a profile or Windows PATH entry is still a transaction. Retain its
/// exact previous text so a failed environment update cannot leave a launcher
/// that points at a new runtime while the old terminal integration remains.
struct LauncherSnapshot {
    path: PathBuf,
    content: Option<String>,
}

impl LauncherSnapshot {
    fn capture(path: PathBuf) -> Result<Self, String> {
        let content = match std::fs::read_to_string(&path) {
            Ok(content) => Some(content),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!(
                    "Failed to read existing terminal launcher {}: {}",
                    path.display(),
                    error
                ));
            }
        };
        Ok(Self { path, content })
    }

    fn restore(self) -> Result<(), String> {
        match self.content {
            Some(content) => paths::atomic_write_text(&self.path, &content),
            None => match std::fs::remove_file(&self.path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(format!(
                    "Failed to remove terminal launcher {} during rollback: {}",
                    self.path.display(),
                    error
                )),
            },
        }
    }
}

#[derive(Debug, Clone, Default)]
pub(super) struct TerminalRuntimeEnvironment {
    pub path_entries: Vec<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
    pub npm_cache: Option<PathBuf>,
}

impl TerminalRuntimeEnvironment {
    fn for_native_runtime(runtime: &crate::commands::system::NativeOpenclawRuntime) -> Self {
        let npm_prefix = runtime
            .npm_prefix()
            .map(Path::to_path_buf)
            .or_else(paths::configured_npm_prefix);
        let mut environment = Self {
            npm_prefix,
            npm_cache: paths::configured_npm_cache_dir(),
            ..Self::default()
        };
        let node_dir = match runtime.launcher_spec() {
            crate::commands::system::NativeOpenclawLaunchSpec::NodeScript { node, .. } => {
                node.parent().map(Path::to_path_buf)
            }
            crate::commands::system::NativeOpenclawLaunchSpec::Executable { .. } => None,
        };
        for candidate in [
            node_dir,
            paths::configured_git_path().and_then(|path| path.parent().map(Path::to_path_buf)),
            environment
                .npm_prefix
                .as_deref()
                .map(paths::npm_bin_dir_for_prefix),
            paths::user_npm_bin_dir(),
        ]
        .into_iter()
        .flatten()
        {
            if !environment
                .path_entries
                .iter()
                .any(|existing| path_entries_equal(existing, &candidate))
            {
                environment.path_entries.push(candidate);
            }
        }
        environment
    }
}

#[derive(Debug, Clone)]
pub(super) struct NativeTerminalLaunch {
    pub launch: crate::commands::system::NativeOpenclawLaunchSpec,
    pub environment: TerminalRuntimeEnvironment,
    pub working_dir: Option<PathBuf>,
}

impl NativeTerminalLaunch {
    fn from_runtime(runtime: &crate::commands::system::NativeOpenclawRuntime) -> Self {
        Self {
            launch: runtime.launcher_spec(),
            environment: TerminalRuntimeEnvironment::for_native_runtime(runtime),
            working_dir: paths::stable_openclaw_working_dir(),
        }
    }
}

/// The launcher is generated from the selected runtime rather than from the
/// accidental presence of a host-side OpenClaw binary. This keeps Docker
/// terminal integration useful on a clean Docker-only installation.
pub(super) enum TerminalLauncherTarget {
    Native(Option<NativeTerminalLaunch>),
    Docker,
}

trait TerminalIntegrationBackend {
    const LAUNCHER_FILENAME: &'static str;

    fn apply_environment(enabled: bool) -> Result<EnvironmentBinding, String>;
    fn detect_environment() -> EnvironmentBinding;
    fn is_environment_configured(binding: &EnvironmentBinding) -> bool;
    fn launcher_contents(target: &TerminalLauncherTarget) -> String;

    fn prepare_launcher(_path: &Path) -> Result<(), String> {
        Ok(())
    }
}

struct TerminalIntegrationService<B>(PhantomData<B>);

impl<B: TerminalIntegrationBackend> TerminalIntegrationService<B> {
    fn launcher_path() -> PathBuf {
        paths::terminal_launcher_dir().join(B::LAUNCHER_FILENAME)
    }

    fn enable(target: &TerminalLauncherTarget) -> Result<TerminalIntegrationStatus, String> {
        paths::validate_runtime_overrides()?;
        let snapshot = Self::write_launcher(target)?;
        let binding =
            B::apply_environment(true).map_err(|error| rollback_launcher(snapshot, error))?;
        Ok(Self::build_status(true, binding, target_is_ready(target)))
    }

    fn disable() -> Result<TerminalIntegrationStatus, String> {
        let snapshot = Self::remove_launcher()?;
        let binding =
            B::apply_environment(false).map_err(|error| rollback_launcher(snapshot, error))?;
        Ok(Self::build_status(false, binding, false))
    }

    fn detect(requested: bool, runtime_ready: bool) -> TerminalIntegrationStatus {
        Self::build_status(requested, B::detect_environment(), runtime_ready)
    }

    fn write_launcher(target: &TerminalLauncherTarget) -> Result<LauncherSnapshot, String> {
        let directory = paths::terminal_launcher_dir();
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create terminal launcher directory: {}", error))?;
        let path = Self::launcher_path();
        let snapshot = LauncherSnapshot::capture(path.clone())?;
        paths::atomic_write_text(&path, &B::launcher_contents(target))?;
        if let Err(error) = B::prepare_launcher(&path) {
            return Err(rollback_launcher(snapshot, error));
        }
        Ok(snapshot)
    }

    fn remove_launcher() -> Result<LauncherSnapshot, String> {
        let path = Self::launcher_path();
        let snapshot = LauncherSnapshot::capture(path.clone())?;
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove terminal launcher: {}", error))?;
        }
        Ok(snapshot)
    }

    fn build_status(
        requested: bool,
        binding: EnvironmentBinding,
        runtime_ready: bool,
    ) -> TerminalIntegrationStatus {
        let launcher = Self::launcher_path();
        let enabled = requested && launcher.is_file() && B::is_environment_configured(&binding);
        let current_path_has_launcher = current_path_contains(&paths::terminal_launcher_dir());
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

fn rollback_launcher(snapshot: LauncherSnapshot, failure: impl Into<String>) -> String {
    let failure = failure.into();
    match snapshot.restore() {
        Ok(()) => failure,
        Err(error) => format!(
            "{}; failed to restore terminal launcher: {}",
            failure, error
        ),
    }
}

fn target_is_ready(target: &TerminalLauncherTarget) -> bool {
    matches!(
        target,
        TerminalLauncherTarget::Docker | TerminalLauncherTarget::Native(Some(_))
    )
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

async fn terminal_launcher_target() -> Result<TerminalLauncherTarget, String> {
    match paths::active_runtime_mode() {
        paths::OpenClawRuntimeMode::Docker => Ok(TerminalLauncherTarget::Docker),
        paths::OpenClawRuntimeMode::Native => {
            crate::commands::system::ensure_openclaw_relocation_complete()?;
            let Some(binary) = crate::commands::system::resolve_openclaw_binary_async().await
            else {
                return Ok(TerminalLauncherTarget::Native(None));
            };
            let runtime = crate::commands::system::compatible_native_openclaw_runtime(binary)
                .await
                .map_err(|error| format!("OpenClaw terminal runtime is unavailable: {error}"))?;
            Ok(TerminalLauncherTarget::Native(Some(
                NativeTerminalLaunch::from_runtime(&runtime),
            )))
        }
    }
}

pub(crate) async fn sync_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    if !paths::terminal_integration_requested() {
        return TerminalIntegrationService::<ActiveBackend>::disable();
    }
    let target = terminal_launcher_target().await?;
    TerminalIntegrationService::<ActiveBackend>::enable(&target)
}

/// Sync against a runtime already validated by setup or relocation. This avoids
/// a second PATH-based discovery pass while a package transition is in flight.
pub(crate) fn sync_terminal_integration_with_native_runtime(
    runtime: &crate::commands::system::NativeOpenclawRuntime,
) -> Result<TerminalIntegrationStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Err("OpenClaw native terminal sync requires the Native runtime".into());
    }
    if !paths::terminal_integration_requested() {
        return TerminalIntegrationService::<ActiveBackend>::disable();
    }
    let target = TerminalLauncherTarget::Native(Some(NativeTerminalLaunch::from_runtime(runtime)));
    TerminalIntegrationService::<ActiveBackend>::enable(&target)
}

/// Disable only the integration artifacts JunQi owns. The normal public sync
/// path checks for a completed OpenClaw relocation; an uninstall must still
/// remove its launcher and PATH entry when a migration was interrupted.
pub(crate) fn disable_terminal_integration_for_uninstall() -> Result<(), String> {
    TerminalIntegrationService::<ActiveBackend>::disable().map(|_| ())
}

#[tauri::command]
pub async fn apply_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    sync_terminal_integration().await
}

#[tauri::command]
pub async fn get_terminal_integration_status() -> Result<TerminalIntegrationStatus, String> {
    let requested = paths::terminal_integration_requested();
    let runtime_ready = if requested {
        match paths::active_runtime_mode() {
            paths::OpenClawRuntimeMode::Docker => true,
            paths::OpenClawRuntimeMode::Native => {
                crate::commands::system::ensure_openclaw_relocation_complete().is_ok()
                    && crate::commands::system::resolve_compatible_native_openclaw_runtime()
                        .await
                        .is_ok()
            }
        }
    } else {
        false
    };
    Ok(TerminalIntegrationService::<ActiveBackend>::detect(
        requested,
        runtime_ready,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_launcher_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!(
                "junqi-terminal-launcher-{label}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ))
            .join("openclaw")
    }

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

    #[test]
    fn launcher_snapshot_restores_the_previous_launcher_content() {
        let path = test_launcher_path("restore");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "previous launcher").unwrap();
        let snapshot = LauncherSnapshot::capture(path.clone()).unwrap();

        paths::atomic_write_text(&path, "replacement launcher").unwrap();
        snapshot.restore().unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "previous launcher");
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn launcher_snapshot_removes_a_launcher_created_during_a_failed_transaction() {
        let path = test_launcher_path("remove");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let snapshot = LauncherSnapshot::capture(path.clone()).unwrap();

        paths::atomic_write_text(&path, "new launcher").unwrap();
        snapshot.restore().unwrap();

        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
