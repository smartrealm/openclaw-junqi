//! JunQi's application-scoped patch of auto-launch 0.5.0.

use std::path::{Path, PathBuf};

#[derive(thiserror::Error, Debug)]
pub enum Error {
    #[error("app_name shouldn't be None")]
    AppNameNotSpecified,
    #[error("app_path shouldn't be None")]
    AppPathNotSpecified,
    #[error("app path doesn't exist: {0}")]
    AppPathDoesntExist(PathBuf),
    #[error("app path is not absolute: {0}")]
    AppPathIsNotAbsolute(PathBuf),
    #[error("Failed to execute apple script with status: {0}")]
    AppleScriptFailed(i32),
    #[error("Unable to determine a user configuration directory")]
    ConfigDirectoryUnavailable,
    #[error("Unsupported target os")]
    UnsupportedOS,
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AutoLaunch {
    pub(crate) app_name: String,
    pub(crate) app_path: String,
    #[cfg(target_os = "macos")]
    pub(crate) use_launch_agent: bool,
    pub(crate) args: Vec<String>,
}

impl AutoLaunch {
    pub fn is_support() -> bool {
        cfg!(any(target_os = "linux", target_os = "macos", target_os = "windows"))
    }

    pub fn get_app_name(&self) -> &str { &self.app_name }
    pub fn get_app_path(&self) -> &str { &self.app_path }
    pub fn get_args(&self) -> &[String] { &self.args }
}

#[derive(Debug, Default, Clone)]
pub struct AutoLaunchBuilder {
    pub app_name: Option<String>,
    pub app_path: Option<String>,
    pub use_launch_agent: bool,
    pub args: Option<Vec<String>>,
}

impl AutoLaunchBuilder {
    pub fn new() -> Self { Self::default() }

    pub fn set_app_name(&mut self, name: &str) -> &mut Self {
        self.app_name = Some(name.into());
        self
    }

    pub fn set_app_path(&mut self, path: &str) -> &mut Self {
        self.app_path = Some(path.into());
        self
    }

    pub fn set_use_launch_agent(&mut self, use_launch_agent: bool) -> &mut Self {
        self.use_launch_agent = use_launch_agent;
        self
    }

    pub fn set_args(&mut self, args: &[impl AsRef<str>]) -> &mut Self {
        self.args = Some(args.iter().map(|value| value.as_ref().to_owned()).collect());
        self
    }

    pub fn build(&self) -> Result<AutoLaunch> {
        let app_name = self.app_name.as_deref().ok_or(Error::AppNameNotSpecified)?;
        let app_path = self.app_path.as_deref().ok_or(Error::AppPathNotSpecified)?;
        let args = self.args.clone().unwrap_or_default();
        #[cfg(target_os = "linux")]
        return Ok(AutoLaunch::new(app_name, app_path, &args));
        #[cfg(target_os = "macos")]
        return Ok(AutoLaunch::new(app_name, app_path, self.use_launch_agent, &args));
        #[cfg(target_os = "windows")]
        return Ok(AutoLaunch::new(app_name, app_path, &args));
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        Err(Error::UnsupportedOS)
    }
}

fn verify_existing_absolute_path(path: &Path) -> Result<()> {
    if !path.exists() { return Err(Error::AppPathDoesntExist(path.to_path_buf())); }
    if !path.is_absolute() { return Err(Error::AppPathIsNotAbsolute(path.to_path_buf())); }
    Ok(())
}

pub fn quote_windows_argument(value: &str) -> String {
    if !value.is_empty() && !value.chars().any(|character| character.is_whitespace() || character == '"') {
        return value.to_owned();
    }
    let mut quoted = String::from('"');
    let mut backslashes = 0usize;
    for character in value.chars() {
        match character {
            '\\' => backslashes += 1,
            '"' => {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            }
            _ => {
                quoted.push_str(&"\\".repeat(backslashes));
                quoted.push(character);
                backslashes = 0;
            }
        }
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

pub fn windows_command_line(app_path: &str, args: &[String]) -> String {
    std::iter::once(app_path)
        .chain(args.iter().map(String::as_str))
        .map(quote_windows_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

fn requires_desktop_exec_quotes(value: &str) -> bool {
    value.chars().any(|character| matches!(
        character,
        ' ' | '\t' | '\n' | '"' | '\'' | '\\' | '>' | '<' | '~' | '|' | '&' | ';' | '$' | '*'
            | '?' | '#' | '(' | ')' | '`'
    ))
}

pub fn quote_desktop_exec_argument(value: &str) -> String {
    if !requires_desktop_exec_quotes(value) { return value.to_owned(); }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"").replace('`', "\\`").replace('$', "\\$");
    format!("\"{escaped}\"")
}

pub fn desktop_exec_command(app_path: &str, args: &[String]) -> String {
    std::iter::once(app_path)
        .chain(args.iter().map(String::as_str))
        .map(quote_desktop_exec_argument)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "windows")]
mod windows;

#[cfg(test)]
mod tests {
    use super::{desktop_exec_command, quote_desktop_exec_argument, quote_windows_argument, windows_command_line};

    #[test]
    fn serializes_windows_paths_and_arguments_with_spaces() {
        let args = vec!["--voice-resident".to_owned(), "wake phrase".to_owned()];
        assert_eq!(
            windows_command_line(r"C:\Program Files\JunQi Desktop\junqi.exe", &args),
            r#""C:\Program Files\JunQi Desktop\junqi.exe" --voice-resident "wake phrase""#,
        );
    }

    #[test]
    fn serializes_windows_trailing_backslashes_before_a_closing_quote() {
        assert_eq!(quote_windows_argument("C:\\wake words\\"), r#""C:\wake words\\""#);
    }

    #[test]
    fn serializes_desktop_entry_arguments_as_quoted_arguments() {
        let args = vec!["--voice-resident".to_owned(), "wake $phrase".to_owned()];
        assert_eq!(
            desktop_exec_command("/opt/JunQi Desktop/junqi", &args),
            "\"/opt/JunQi Desktop/junqi\" --voice-resident \"wake \\$phrase\"",
        );
        assert_eq!(quote_desktop_exec_argument("quote\"`\\"), "\"quote\\\"\\`\\\\\"");
    }
}
