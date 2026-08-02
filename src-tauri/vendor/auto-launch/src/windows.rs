use crate::{windows_command_line, AutoLaunch, Result};
use winreg::enums::RegType::REG_BINARY;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
use winreg::{RegKey, RegValue};

const RUN_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run";
const STARTUP_APPROVED_KEY: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const ENABLED_VALUE: [u8; 12] = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

impl AutoLaunch {
    pub fn new(app_name: &str, app_path: &str, args: &[impl AsRef<str>]) -> Self {
        Self { app_name: app_name.into(), app_path: app_path.into(), args: args.iter().map(|value| value.as_ref().to_owned()).collect() }
    }

    pub fn enable(&self) -> Result<()> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        current_user.open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)?.set_value(
            &self.app_name,
            &windows_command_line(&self.app_path, &self.args),
        )?;
        if let Ok(key) = current_user.open_subkey_with_flags(STARTUP_APPROVED_KEY, KEY_SET_VALUE) {
            key.set_raw_value(&self.app_name, &RegValue { vtype: REG_BINARY, bytes: ENABLED_VALUE.to_vec() })?;
        }
        Ok(())
    }

    pub fn disable(&self) -> Result<()> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE)?.delete_value(&self.app_name)?;
        Ok(())
    }

    pub fn is_enabled(&self) -> Result<bool> {
        let current_user = RegKey::predef(HKEY_CURRENT_USER);
        let enabled = current_user.open_subkey_with_flags(RUN_KEY, KEY_READ)?.get_value::<String, _>(&self.app_name).is_ok();
        Ok(enabled && self.task_manager_enabled(current_user).unwrap_or(true))
    }

    fn task_manager_enabled(&self, current_user: RegKey) -> Option<bool> {
        let value = current_user.open_subkey_with_flags(STARTUP_APPROVED_KEY, KEY_READ).ok()?.get_raw_value(&self.app_name).ok()?;
        (value.bytes.len() >= 8).then(|| value.bytes.iter().rev().take(8).all(|byte| *byte == 0))
    }
}
