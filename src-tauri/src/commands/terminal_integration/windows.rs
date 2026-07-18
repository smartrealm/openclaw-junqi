use super::{
    selected_runtime_environment, updated_windows_path, EnvironmentBinding,
    TerminalIntegrationBackend, TerminalLauncherTarget,
};
use crate::paths;
use std::path::Path;

pub(super) struct WindowsBackend;

impl TerminalIntegrationBackend for WindowsBackend {
    const LAUNCHER_FILENAME: &'static str = "openclaw.cmd";

    fn apply_environment(enabled: bool) -> Result<EnvironmentBinding, String> {
        update_user_path(enabled)?;
        crate::commands::setup::refresh_path_from_registry();
        Ok(EnvironmentBinding::default())
    }

    fn detect_environment() -> EnvironmentBinding {
        EnvironmentBinding::default()
    }

    fn is_environment_configured(_binding: &EnvironmentBinding) -> bool {
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

    fn launcher_contents(target: TerminalLauncherTarget<'_>) -> String {
        match target {
            TerminalLauncherTarget::Docker => docker_launcher_contents(),
            TerminalLauncherTarget::Native(binary) => native_launcher_contents(binary),
        }
    }
}

fn native_launcher_contents(binary: Option<&Path>) -> String {
    let command = binary.map_or_else(missing_binary_command, native_binary_command);
    let runtime = selected_runtime_environment();
    let path = runtime
        .path_entries
        .iter()
        .map(|path| batch_escape(path))
        .collect::<Vec<_>>()
        .join(";");
    let path_line = (!path.is_empty())
        .then(|| format!("set \"PATH={path};%PATH%\"\r\n"))
        .unwrap_or_default();
    let prefix_line = runtime
        .npm_prefix
        .as_deref()
        .map(|path| format!("set \"npm_config_prefix={}\"\r\n", batch_escape(path)))
        .unwrap_or_default();
    let cache_line = runtime
        .npm_cache
        .as_deref()
        .map(|path| format!("set \"npm_config_cache={}\"\r\n", batch_escape(path)))
        .unwrap_or_default();
    format!(
            "@echo off\r\nsetlocal DisableDelayedExpansion\r\nset \"OPENCLAW_STATE_DIR={}\"\r\nset \"OPENCLAW_CONFIG_PATH={}\"\r\n{}{}{}{}\r\n",
            batch_escape(&paths::desktop_dir()),
            batch_escape(&paths::config_path()),
            path_line,
            prefix_line,
            cache_line,
            command
        )
}

fn native_binary_command(binary: &Path) -> String {
    if let Some(entry) = crate::commands::system::openclaw_package_dir(binary)
        .map(|package| package.join("openclaw.mjs"))
        .filter(|entry| entry.is_file())
    {
        let node = paths::configured_node_path()
            .filter(|path| path.is_file())
            .or_else(|| {
                let detected = crate::platform::detect_path("node");
                (!detected.is_empty()).then(|| detected.into())
            });
        if let Some(node) = node {
            return format!(
                "\"{}\" \"{}\" %*",
                batch_escape(&node),
                batch_escape(&entry)
            );
        }
    }
    if binary
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ps1"))
    {
        return format!(
            "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"{}\" %*",
            batch_escape(binary)
        );
    }
    format!("call \"{}\" %*", batch_escape(binary))
}

fn docker_launcher_contents() -> String {
    let container = crate::commands::docker::OPENCLAW_CONTAINER_NAME;
    format!(
        "@echo off\r\nsetlocal DisableDelayedExpansion\r\ndocker version >nul 2>&1\r\nif errorlevel 1 (\r\n  echo Docker CLI is not available. Start Docker Desktop, then retry. 1>&2\r\n  exit /b 1\r\n)\r\ndocker exec -i {container} openclaw %*\r\n"
    )
}

fn missing_binary_command() -> String {
    "echo OpenClaw is not installed yet. Finish setup in JunQi Desktop. 1>&2\r\nexit /b 1".into()
}

fn batch_escape(value: &Path) -> String {
    crate::commands::system::display_path_text(&value.to_string_lossy()).replace('%', "%%")
}

fn update_user_path(enabled: bool) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, REG_EXPAND_SZ};
    use winreg::types::ToRegValue;
    use winreg::RegKey;

    let (environment, _) = RegKey::predef(HKEY_CURRENT_USER)
        .create_subkey("Environment")
        .map_err(|error| format!("Failed to open the user environment registry: {}", error))?;
    let launcher = paths::terminal_launcher_dir().to_string_lossy().to_string();
    validate_launcher_path(&launcher)?;
    let current = read_user_path(&environment)?;
    let next = updated_windows_path(&current, &launcher, enabled);
    if next == current {
        return Ok(());
    }
    validate_path_length(&next)?;

    let original = environment.get_raw_value("Path").ok();
    let existing_type = original.as_ref().map(|value| value.vtype.clone());
    let mut next_value = next.to_reg_value();
    if existing_type == Some(REG_EXPAND_SZ) {
        next_value.vtype = REG_EXPAND_SZ;
    }
    environment
        .set_raw_value("Path", &next_value)
        .map_err(|error| format!("Failed to update the user PATH: {}", error))?;
    if let Err(error) = broadcast_environment_change() {
        return Err(rollback_user_path(&environment, original.as_ref(), error));
    }
    Ok(())
}

fn rollback_user_path(
    environment: &winreg::RegKey,
    original: Option<&winreg::RegValue>,
    failure: String,
) -> String {
    let rollback = match original {
        Some(value) => environment.set_raw_value("Path", value),
        None => environment.delete_value("Path"),
    };
    match rollback {
        Ok(()) => failure,
        Err(error) if original.is_none() && error.kind() == std::io::ErrorKind::NotFound => failure,
        Err(error) => format!("{}; failed to restore the user PATH: {}", failure, error),
    }
}

fn validate_launcher_path(launcher: &str) -> Result<(), String> {
    if launcher.contains(';') {
        Err("The JunQi launcher directory cannot contain a semicolon on Windows".into())
    } else {
        Ok(())
    }
}

fn validate_path_length(path: &str) -> Result<(), String> {
    if path.encode_utf16().count() >= 32_767 {
        Err("The Windows user PATH is too long to add the JunQi launcher".into())
    } else {
        Ok(())
    }
}

fn read_user_path(environment: &winreg::RegKey) -> Result<String, String> {
    match environment.get_value("Path") {
        Ok(value) => Ok(value),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Failed to read the user PATH: {}", error)),
    }
}

fn broadcast_environment_change() -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
    };

    let environment = "Environment\0".encode_utf16().collect::<Vec<_>>();
    // SAFETY: `environment` remains alive for the synchronous call, is NUL-terminated,
    // and the API only reads the pointer while broadcasting WM_SETTINGCHANGE.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_semicolon_in_launcher_path() {
        assert!(validate_launcher_path(r"C:\JunQi;Other").is_err());
        assert!(validate_launcher_path(r"C:\JunQi\bin").is_ok());
    }
}
