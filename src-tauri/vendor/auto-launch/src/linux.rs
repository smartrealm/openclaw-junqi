use crate::{desktop_exec_command, AutoLaunch, Error, Result};
use std::fs;
use std::path::{Path, PathBuf};

impl AutoLaunch {
    pub fn new(app_name: &str, app_path: &str, args: &[impl AsRef<str>]) -> Self {
        Self { app_name: app_name.into(), app_path: app_path.into(), args: args.iter().map(|value| value.as_ref().to_owned()).collect() }
    }

    pub fn enable(&self) -> Result<()> {
        let directory = autostart_directory()?;
        fs::create_dir_all(&directory)?;
        fs::write(self.desktop_file(&directory), format!(
            "[Desktop Entry]\\nType=Application\\nVersion=1.0\\nName={}\\nComment={} startup script\\nExec={}\\nStartupNotify=false\\nTerminal=false\\n",
            self.app_name, self.app_name, desktop_exec_command(&self.app_path, &self.args),
        ))?;
        Ok(())
    }

    pub fn disable(&self) -> Result<()> {
        let file = self.desktop_file(&autostart_directory()?);
        if file.exists() { fs::remove_file(file)?; }
        Ok(())
    }

    pub fn is_enabled(&self) -> Result<bool> {
        Ok(self.desktop_file(&autostart_directory()?).exists())
    }

    fn desktop_file(&self, directory: &Path) -> PathBuf { directory.join(format!("{}.desktop", self.app_name)) }
}

fn autostart_directory() -> Result<PathBuf> {
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| dirs::home_dir().map(|home| home.join(".config")))
        .ok_or(Error::ConfigDirectoryUnavailable)?;
    Ok(config_home.join("autostart"))
}
