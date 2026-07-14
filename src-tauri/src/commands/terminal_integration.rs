use crate::{paths, platform};
use serde::Serialize;
use std::path::{Path, PathBuf};

const BLOCK_START: &str = "# >>> JunQi Desktop OpenClaw integration >>>";
const BLOCK_END: &str = "# <<< JunQi Desktop OpenClaw integration <<<";

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

impl EnvironmentBinding {
    fn apply(enabled: bool) -> Result<Self, String> {
        Ok(Self {
            profile_path: configure_platform_environment(enabled)?,
        })
    }

    fn detect() -> Self {
        Self {
            profile_path: current_platform_profile(),
        }
    }

    fn is_configured(&self) -> bool {
        platform_environment_is_configured(self.profile_path.as_deref())
    }
}

fn launcher_path() -> PathBuf {
    paths::terminal_launcher_dir().join(if cfg!(windows) {
        "openclaw.cmd"
    } else {
        "openclaw"
    })
}

fn shell_profile_path() -> Result<PathBuf, String> {
    let home = platform::home_dir().ok_or("Could not determine the user home directory")?;
    let shell = std::env::var("SHELL").unwrap_or_default();
    let name = Path::new(&shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("sh");
    match name {
        "zsh" => Ok(home.join(".zprofile")),
        "bash" => {
            let bash_profile = home.join(".bash_profile");
            Ok(if bash_profile.exists() {
                bash_profile
            } else {
                home.join(".profile")
            })
        }
        "sh" | "dash" => Ok(home.join(".profile")),
        unsupported => Err(format!(
            "Automatic terminal integration does not support shell `{}`; keep integration disabled and configure PATH manually",
            unsupported
        )),
    }
}

fn shell_quote(value: &Path) -> String {
    format!("'{}'", value.to_string_lossy().replace('\'', "'\\''"))
}

fn remove_managed_block(content: &str) -> Result<String, String> {
    let mut output = String::with_capacity(content.len());
    let mut inside = false;
    for line in content.split_inclusive('\n') {
        let marker = line.trim_end_matches(['\r', '\n']).trim();
        if marker == BLOCK_START {
            if inside {
                return Err("Terminal integration profile contains a nested start marker".into());
            }
            inside = true;
            continue;
        }
        if marker == BLOCK_END {
            if !inside {
                return Err("Terminal integration profile contains an unmatched end marker".into());
            }
            inside = false;
            continue;
        }
        if !inside {
            output.push_str(line);
        }
    }
    if inside {
        return Err("Terminal integration profile contains an unterminated managed block".into());
    }
    Ok(output)
}

#[cfg(not(windows))]
fn read_profile(path: &Path) -> Result<String, String> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Failed to read {}: {}", path.display(), error)),
    }
}

#[cfg(not(windows))]
fn known_profile_paths() -> Result<Vec<PathBuf>, String> {
    let home = platform::home_dir().ok_or("Could not determine the user home directory")?;
    Ok(vec![
        home.join(".zprofile"),
        home.join(".bash_profile"),
        home.join(".profile"),
    ])
}

#[cfg(not(windows))]
fn update_profile(path: &Path, enabled: bool) -> Result<(), String> {
    let current = read_profile(path)?;
    let mut next = remove_managed_block(&current)?;
    if enabled {
        if !next.is_empty() && !next.ends_with('\n') {
            next.push('\n');
        }
        next.push_str(&format!(
            "{}\nexport PATH={}:\"$PATH\"\n{}\n",
            BLOCK_START,
            shell_quote(&paths::terminal_launcher_dir()),
            BLOCK_END,
        ));
    }
    if next == current {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create shell profile directory: {}", error))?;
    }
    paths::atomic_write_text(path, &next)
        .map_err(|error| format!("Failed to update {}: {}", path.display(), error))
}

#[cfg(not(windows))]
fn configure_platform_environment(enabled: bool) -> Result<Option<PathBuf>, String> {
    if enabled {
        let profile = shell_profile_path()?;
        update_profile(&profile, true)?;
        return Ok(Some(profile));
    }

    for profile in known_profile_paths()? {
        if profile.exists() {
            update_profile(&profile, false)?;
        }
    }
    Ok(None)
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

fn path_entries_equal(left: &Path, right: &Path) -> bool {
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

#[cfg(windows)]
fn broadcast_windows_environment_change() -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let environment = "Environment\0".encode_utf16().collect::<Vec<_>>();
    let sent = unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            environment.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5_000,
            std::ptr::null_mut(),
        )
    };
    if sent == 0 {
        Err(format!(
            "Failed to broadcast the Windows environment update: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
fn configure_platform_environment(enabled: bool) -> Result<Option<PathBuf>, String> {
    use winreg::enums::{HKEY_CURRENT_USER, REG_EXPAND_SZ};
    use winreg::types::ToRegValue;
    use winreg::RegKey;

    let (environment, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Environment")
        .map_err(|error| format!("Failed to open the user environment registry: {}", error))?;
    let launcher = paths::terminal_launcher_dir().to_string_lossy().to_string();
    if launcher.contains(';') {
        return Err("The JunQi launcher directory cannot contain a semicolon on Windows".into());
    }
    let current: String = match environment.get_value("Path") {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Failed to read the user PATH: {}", error)),
    };
    let next = updated_windows_path(&current, &launcher, enabled);
    if next != current {
        if next.encode_utf16().count() >= 32_767 {
            return Err("The Windows user PATH is too long to add the JunQi launcher".into());
        }
        let existing_type = environment
            .get_raw_value("Path")
            .ok()
            .map(|value| value.vtype);
        let mut next_value = next.to_reg_value();
        if existing_type == Some(REG_EXPAND_SZ) {
            next_value.vtype = REG_EXPAND_SZ;
        }
        environment
            .set_raw_value("Path", &next_value)
            .map_err(|error| format!("Failed to update the user PATH: {}", error))?;
        broadcast_windows_environment_change()?;
    }
    crate::commands::setup::refresh_path_from_registry();
    Ok(None)
}

#[cfg(not(windows))]
fn launcher_contents(binary: Option<&Path>) -> String {
    let state = shell_quote(&paths::desktop_dir());
    let config = shell_quote(&paths::config_path());
    let node = shell_quote(&paths::node_bin_dir());
    let git = shell_quote(&paths::git_bin_dir());
    let npm = paths::configured_npm_prefix()
        .map(|prefix| {
            if cfg!(windows) {
                prefix
            } else {
                prefix.join("bin")
            }
        })
        .unwrap_or_else(paths::local_npm_bin_dir);
    let npm = shell_quote(&npm);
    let command = binary.map_or_else(
        || {
            "printf '%s\n' 'OpenClaw is not installed yet. Finish setup in JunQi Desktop.' >&2\nexit 1"
                .to_string()
        },
        |path| format!("exec {} \"$@\"", shell_quote(path)),
    );
    format!(
        "#!/bin/sh\nexport OPENCLAW_STATE_DIR={}\nexport OPENCLAW_CONFIG_PATH={}\nexport PATH={}:{}:{}:\"$PATH\"\n{}\n",
        state, config, node, git, npm, command
    )
}

#[cfg(windows)]
fn batch_escape(value: &Path) -> String {
    value.to_string_lossy().replace('%', "%%")
}

#[cfg(windows)]
fn launcher_contents(binary: Option<&Path>) -> String {
    let command = binary.map_or_else(
        || {
            "echo OpenClaw is not installed yet. Finish setup in JunQi Desktop. 1>&2\r\nexit /b 1"
                .to_string()
        },
        |path| format!("call \"{}\" %*", batch_escape(path)),
    );
    let npm = paths::configured_npm_prefix().unwrap_or_else(paths::local_npm_prefix);
    format!(
        "@echo off\r\nset \"OPENCLAW_STATE_DIR={}\"\r\nset \"OPENCLAW_CONFIG_PATH={}\"\r\nset \"PATH={};{};{};%PATH%\"\r\n{}\r\n",
        batch_escape(&paths::desktop_dir()),
        batch_escape(&paths::config_path()),
        batch_escape(&paths::node_bin_dir()),
        batch_escape(&paths::git_bin_dir()),
        batch_escape(&npm),
        command
    )
}

fn write_launcher(binary: Option<&Path>) -> Result<(), String> {
    let directory = paths::terminal_launcher_dir();
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create terminal launcher directory: {}", error))?;
    let path = launcher_path();
    paths::atomic_write_text(&path, &launcher_contents(binary))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Failed to make terminal launcher executable: {}", error))?;
    }
    Ok(())
}

fn remove_launcher() -> Result<(), String> {
    let path = launcher_path();
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|error| format!("Failed to remove terminal launcher: {}", error))?;
    }
    Ok(())
}

#[cfg(windows)]
fn platform_environment_is_configured(_profile: Option<&Path>) -> bool {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let launcher = paths::terminal_launcher_dir().to_string_lossy().to_string();
    RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Environment")
        .ok()
        .and_then(|key| key.get_value::<String, _>("Path").ok())
        .is_some_and(|path| {
            path.split(';')
                .any(|entry| entry.trim().eq_ignore_ascii_case(&launcher))
        })
}

#[cfg(not(windows))]
fn platform_environment_is_configured(profile: Option<&Path>) -> bool {
    profile
        .and_then(|path| std::fs::read_to_string(path).ok())
        .is_some_and(|content| content.contains(BLOCK_START) && content.contains(BLOCK_END))
}

#[cfg(windows)]
fn current_platform_profile() -> Option<PathBuf> {
    None
}

#[cfg(not(windows))]
fn current_platform_profile() -> Option<PathBuf> {
    shell_profile_path().ok()
}

pub(crate) fn sync_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    let requested = paths::terminal_integration_requested();
    let binding = if requested {
        write_launcher(crate::commands::system::resolve_openclaw_binary().as_deref())?;
        EnvironmentBinding::apply(true)?
    } else {
        let binding = EnvironmentBinding::apply(false)?;
        remove_launcher()?;
        binding
    };
    Ok(build_status(requested, binding))
}

fn build_status(requested: bool, binding: EnvironmentBinding) -> TerminalIntegrationStatus {
    let launcher = launcher_path();
    let enabled = requested && launcher.is_file() && binding.is_configured();
    let current_path_has_launcher =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
            .any(|entry| path_entries_equal(&entry, &paths::terminal_launcher_dir()));
    TerminalIntegrationStatus {
        requested,
        enabled,
        launcher_ready: launcher.is_file()
            && crate::commands::system::resolve_openclaw_binary().is_some(),
        launcher_dir: paths::terminal_launcher_dir().to_string_lossy().to_string(),
        launcher_path: launcher.to_string_lossy().to_string(),
        profile_path: binding
            .profile_path
            .map(|path| path.to_string_lossy().to_string()),
        terminal_restart_required: enabled && !current_path_has_launcher,
        message: if enabled {
            if current_path_has_launcher {
                "Terminal integration is active".into()
            } else {
                "Terminal integration is configured; open a new terminal to use it".into()
            }
        } else if requested {
            "Terminal integration is pending".into()
        } else {
            "Terminal integration is disabled".into()
        },
    }
}

#[tauri::command]
pub async fn apply_terminal_integration() -> Result<TerminalIntegrationStatus, String> {
    sync_terminal_integration()
}

#[tauri::command]
pub async fn get_terminal_integration_status() -> Result<TerminalIntegrationStatus, String> {
    let requested = paths::terminal_integration_requested();
    Ok(build_status(requested, EnvironmentBinding::detect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_profile_block_is_replaced_without_touching_user_content() {
        let current = format!("export USER_VALUE=1\n{}\nold\n{}\n", BLOCK_START, BLOCK_END);
        assert_eq!(
            remove_managed_block(&current).unwrap(),
            "export USER_VALUE=1\n"
        );
    }

    #[test]
    fn malformed_profile_blocks_fail_closed() {
        let unterminated = format!("export USER_VALUE=1\n{}\nkeep-me\n", BLOCK_START);
        assert!(remove_managed_block(&unterminated).is_err());

        let unmatched = format!("export USER_VALUE=1\n{}\n", BLOCK_END);
        assert!(remove_managed_block(&unmatched).is_err());

        let nested = format!("{}\n{}\n{}\n", BLOCK_START, BLOCK_START, BLOCK_END);
        assert!(remove_managed_block(&nested).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn unreadable_text_profile_is_never_overwritten() {
        let root = std::env::temp_dir().join(format!(
            "junqi-profile-safety-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let profile = root.join(".zprofile");
        let original = [0xff, 0xfe, b'\n'];
        std::fs::write(&profile, original).unwrap();

        assert!(update_profile(&profile, true).is_err());
        assert_eq!(std::fs::read(&profile).unwrap(), original);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn launcher_never_embeds_gateway_credentials() {
        let content = launcher_contents(None);
        assert!(content.contains("OPENCLAW_STATE_DIR"));
        assert!(content.contains("OPENCLAW_CONFIG_PATH"));
        assert!(!content.contains("GATEWAY_TOKEN"));
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
}
