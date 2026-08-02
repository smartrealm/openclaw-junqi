use crate::{verify_existing_absolute_path, AutoLaunch, Error, Result};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

impl AutoLaunch {
    pub fn new(app_name: &str, app_path: &str, use_launch_agent: bool, args: &[impl AsRef<str>]) -> Self {
        let resolved_name = if use_launch_agent { app_name } else { app_path.trim_end_matches(".app").rsplit('/').next().unwrap_or(app_name) };
        Self { app_name: resolved_name.into(), app_path: app_path.into(), use_launch_agent, args: args.iter().map(|value| value.as_ref().to_owned()).collect() }
    }

    pub fn enable(&self) -> Result<()> {
        verify_existing_absolute_path(Path::new(&self.app_path))?;
        if self.use_launch_agent {
            let directory = launch_agents_directory()?;
            fs::create_dir_all(&directory)?;
            let mut arguments = vec![self.app_path.clone()];
            arguments.extend(self.args.iter().cloned());
            let values = arguments.iter().map(|value| format!("<string>{}</string>", xml_escape(value))).collect::<String>();
            fs::write(self.launch_agent_file(&directory), format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\\n<plist version=\"1.0\"><dict><key>Label</key><string>{}</string><key>ProgramArguments</key><array>{}</array><key>RunAtLoad</key><true/></dict></plist>\\n",
                xml_escape(&self.app_name), values,
            ))?;
            return Ok(());
        }
        let hidden = self.args.iter().any(|argument| argument == "--hidden" || argument == "--minimized");
        let command = format!("tell application \"System Events\" to make login item at end with properties {{name:\"{}\",path:\"{}\",hidden:{hidden}}}", apple_script_escape(&self.app_name), apple_script_escape(&self.app_path));
        let output = Command::new("osascript").args(["-e", &command]).output()?;
        if output.status.success() { Ok(()) } else { Err(Error::AppleScriptFailed(output.status.code().unwrap_or(1))) }
    }

    pub fn disable(&self) -> Result<()> {
        if self.use_launch_agent {
            let file = self.launch_agent_file(&launch_agents_directory()?);
            if file.exists() { fs::remove_file(file)?; }
            return Ok(());
        }
        let command = format!("tell application \"System Events\" to delete login item \"{}\"", apple_script_escape(&self.app_name));
        let output = Command::new("osascript").args(["-e", &command]).output()?;
        if output.status.success() { Ok(()) } else { Err(Error::AppleScriptFailed(output.status.code().unwrap_or(1))) }
    }

    pub fn is_enabled(&self) -> Result<bool> {
        if self.use_launch_agent { return Ok(self.launch_agent_file(&launch_agents_directory()?).exists()); }
        let output = Command::new("osascript").args(["-e", "tell application \"System Events\" to get the name of every login item"]).output()?;
        Ok(output.status.success() && std::str::from_utf8(&output.stdout).unwrap_or_default().split(',').any(|name| name.trim() == self.app_name))
    }

    fn launch_agent_file(&self, directory: &Path) -> PathBuf { directory.join(format!("{}.plist", self.app_name)) }
}

fn launch_agents_directory() -> Result<PathBuf> {
    dirs::home_dir().map(|home| home.join("Library").join("LaunchAgents")).ok_or(Error::ConfigDirectoryUnavailable)
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn apple_script_escape(value: &str) -> String { value.replace('\\', "\\\\").replace('"', "\\\"") }
