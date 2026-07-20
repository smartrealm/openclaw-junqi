//! 平台抽象层：操作系统差异尽量集中在这里。
//!
//! 其他模块不应直接散落使用 `cfg!(windows)`、`cfg!(target_os)` 或
//! `#[cfg(windows)]` 来处理行为差异。

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct ShellCommand {
    pub program: String,
    pub args: Vec<String>,
}

static LOGIN_ENV: OnceLock<Vec<(String, String)>> = OnceLock::new();
static LOGIN_PATH: OnceLock<String> = OnceLock::new();
#[cfg(windows)]
static WINDOWS_PATH_DISCOVERY_INITIALIZED: OnceLock<()> = OnceLock::new();

/// Windows 下补充可执行文件后缀，其他平台保持原样。
///
/// ```ignore
/// let node = bin_name("node");   // Windows: "node.exe"，其他平台: "node"
/// let npm  = bin_name("npm");    // Windows: "npm.cmd"，其他平台: "npm"
/// ```
pub fn bin_name(base: &str) -> String {
    if cfg!(windows) {
        match base {
            "npm" => "npm.cmd".to_string(),
            "openclaw" => "openclaw.cmd".to_string(),
            _ => format!("{}.exe", base),
        }
    } else {
        base.to_string()
    }
}

/// Keep background CLI operations from opening a visible console window on Windows.
pub fn configure_background_command(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    #[cfg(not(windows))]
    let _ = command;
}

/// Equivalent background-process policy for the small number of synchronous
/// utility commands launched from Windows drop/cancellation paths.
#[cfg(windows)]
pub fn configure_background_std_command(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

pub fn home_dir() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .or_else(
                || match (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH")) {
                    (Some(drive), Some(path)) => {
                        let mut full = PathBuf::from(drive);
                        full.push(PathBuf::from(path));
                        Some(full)
                    }
                    _ => dirs::home_dir(),
                },
            )
    } else {
        dirs::home_dir()
    }
}

pub fn login_shell_env() -> &'static [(String, String)] {
    LOGIN_ENV.get_or_init(resolve_login_shell_env).as_slice()
}

pub fn login_shell_path() -> &'static str {
    LOGIN_PATH.get_or_init(|| {
        login_shell_env()
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
            .map(|(_, value)| value.clone())
            .unwrap_or_default()
    })
}

/// Search path for commands executed after an in-process Windows installer.
/// Windows executable discovery refreshes the live process PATH from the
/// registry, so a startup-only `OnceLock` cannot keep a pre-install value for
/// npm/Git/Node probes.
pub fn current_search_path() -> String {
    if cfg!(windows) {
        if let Ok(path) = std::env::var("PATH") {
            if !path.trim().is_empty() {
                return path;
            }
        }
    }
    login_shell_path().to_string()
}

/// Normalized Windows `PATH` entries shared by registry import and executable
/// discovery. Windows accepts quoted entries in environment values, but a
/// quoted directory is not itself a filesystem path. Keep the normalization
/// here so Node, Git, npm shims, and every other command share one search
/// model.
#[derive(Debug, Default)]
pub(crate) struct WindowsPathEntries {
    entries: Vec<PathBuf>,
}

impl WindowsPathEntries {
    pub(crate) fn parse(value: &str) -> Self {
        let mut paths = Self::default();
        for segment in split_windows_path_segments(value) {
            if let Some(entry) = normalize_windows_path_segment(segment) {
                paths.push_unique(entry);
            }
        }
        paths
    }

    fn push_unique(&mut self, entry: PathBuf) {
        if self.entries.iter().any(|known| {
            known
                .to_string_lossy()
                .eq_ignore_ascii_case(&entry.to_string_lossy())
        }) {
            return;
        }
        self.entries.push(entry);
    }

    #[cfg(windows)]
    fn extend(&mut self, other: Self) {
        for entry in other.entries {
            self.push_unique(entry);
        }
    }

    #[cfg(windows)]
    fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    fn iter(&self) -> impl Iterator<Item = &PathBuf> {
        self.entries.iter()
    }
}

fn split_windows_path_segments(value: &str) -> Vec<&str> {
    let mut segments = Vec::new();
    let mut quoted = false;
    let mut start = 0;
    for (index, character) in value.char_indices() {
        match character {
            '"' => quoted = !quoted,
            ';' if !quoted => {
                segments.push(&value[start..index]);
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    segments.push(&value[start..]);
    segments
}

fn normalize_windows_path_segment(segment: &str) -> Option<PathBuf> {
    let trimmed = segment.trim();
    let unquoted = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(trimmed)
        .trim();
    (!unquoted.is_empty()).then(|| PathBuf::from(unquoted))
}

/// Merge Windows' registered PATH entries into this GUI process without
/// changing the user's existing command precedence.
///
/// Desktop applications inherit PATH only once, before an MSI, winget, or a
/// prior terminal session may have updated the registry. Keeping the current
/// process PATH first preserves version-manager choices; appending missing
/// machine and user entries makes already-installed system Node.js and Git
/// discoverable without a restart. Installers call this again after mutation.
#[cfg(windows)]
pub fn refresh_process_path_from_registry() {
    refresh_windows_path_from_registry();
}

#[cfg(windows)]
fn ensure_windows_path_for_discovery() {
    WINDOWS_PATH_DISCOVERY_INITIALIZED.get_or_init(|| refresh_windows_path_from_registry());
}

#[cfg(windows)]
fn refresh_windows_path_from_registry() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    fn registry_string(value: &RegValue) -> Option<OsString> {
        let mut wide = value
            .bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        while wide.last() == Some(&0) {
            wide.pop();
        }
        if value.vtype != REG_EXPAND_SZ {
            return Some(OsString::from_wide(&wide));
        }

        wide.push(0);
        let required = unsafe { ExpandEnvironmentStringsW(wide.as_ptr(), std::ptr::null_mut(), 0) };
        if required == 0 {
            return None;
        }
        let mut expanded = vec![0_u16; required as usize];
        let written = unsafe {
            ExpandEnvironmentStringsW(wide.as_ptr(), expanded.as_mut_ptr(), expanded.len() as u32)
        };
        if written == 0 || written > required {
            return None;
        }
        expanded.truncate(written.saturating_sub(1) as usize);
        Some(OsString::from_wide(&expanded))
    }

    fn push_unique(parts: &mut WindowsPathEntries, value: OsString) {
        parts.extend(WindowsPathEntries::parse(&value.to_string_lossy()));
    }

    let mut parts = WindowsPathEntries::default();
    // Preserve the launch environment first. This keeps an intentional Volta,
    // fnm, or other version-manager selection ahead of a system installation.
    if let Some(current) = std::env::var_os("PATH") {
        push_unique(&mut parts, current);
    }
    if let Ok(environment) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
    {
        if let Ok(value) = environment.get_raw_value("Path") {
            if let Some(path) = registry_string(&value) {
                push_unique(&mut parts, path);
            }
        }
    }
    if let Ok(environment) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        if let Ok(value) = environment.get_raw_value("Path") {
            if let Some(path) = registry_string(&value) {
                push_unique(&mut parts, path);
            }
        }
    }
    if !parts.is_empty() {
        if let Ok(joined) = std::env::join_paths(parts.iter()) {
            std::env::set_var("PATH", joined);
        }
    }
}

pub fn default_shell_command() -> ShellCommand {
    if cfg!(windows) {
        if !detect_path("pwsh").is_empty() {
            return ShellCommand {
                program: detect_path("pwsh"),
                args: vec!["-NoLogo".to_string()],
            };
        }
        if !detect_path("powershell").is_empty() {
            return ShellCommand {
                program: detect_path("powershell"),
                args: vec!["-NoLogo".to_string()],
            };
        }
        return ShellCommand {
            program: std::env::var("ComSpec")
                .unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".to_string()),
            args: Vec::new(),
        };
    }

    let fallback = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };
    ShellCommand {
        program: std::env::var("SHELL").unwrap_or_else(|_| fallback.to_string()),
        args: vec!["-l".to_string()],
    }
}

pub fn detect_path(binary: &str) -> String {
    if binary.contains('\\') || binary.contains('/') {
        let candidate = PathBuf::from(binary);
        return if candidate.exists() {
            candidate.to_string_lossy().into_owned()
        } else {
            String::new()
        };
    }

    #[cfg(windows)]
    ensure_windows_path_for_discovery();

    if cfg!(windows) {
        // Package installation can update PATH after LOGIN_PATH is initialized.
        // Probe the live process environment first, then fall back to the
        // captured login environment used during initial detection.
        if let Ok(current) = std::env::var("PATH") {
            if let Some(path) = find_on_windows_path(binary, &current) {
                return path;
            }
        }
        return find_on_windows_path(binary, login_shell_path()).unwrap_or_default();
    }

    std::process::Command::new("which")
        .arg(binary)
        .env("PATH", login_shell_path())
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|path| !path.is_empty())
        .unwrap_or_default()
}

/// Return every executable candidate visible to the current process.
///
/// Windows commonly has several Node.js installations on PATH (for example,
/// a version-manager shim followed by the system installer). Callers that
/// need a specific runtime contract must evaluate every candidate instead of
/// treating the first path entry as the machine's only installation.
pub fn detect_paths(binary: &str) -> Vec<String> {
    if binary.contains('\\') || binary.contains('/') {
        return PathBuf::from(binary)
            .is_file()
            .then(|| binary.to_string())
            .into_iter()
            .collect();
    }

    #[cfg(windows)]
    ensure_windows_path_for_discovery();

    #[cfg(windows)]
    {
        let mut candidates = Vec::new();
        for path_value in [
            std::env::var("PATH").unwrap_or_default(),
            login_shell_path().to_string(),
        ] {
            for candidate in find_all_on_windows_path(binary, &path_value) {
                if !candidates
                    .iter()
                    .any(|known: &String| known.eq_ignore_ascii_case(&candidate))
                {
                    candidates.push(candidate);
                }
            }
        }
        return candidates;
    }

    #[cfg(not(windows))]
    {
        let detected = detect_path(binary);
        (!detected.is_empty())
            .then_some(detected)
            .into_iter()
            .collect()
    }
}

/// 在传给 `portable-pty` 前先解析命令路径。
///
/// Windows 上 npm 安装的 CLI 通常是 `claude.cmd`、`codex.cmd`、
/// `openclaw.cmd` 这类 shim。并非所有 PTY 后端都会像交互式 shell 一样
/// 完整执行 PATHEXT 搜索，所以这里尽量传入明确路径。
pub fn resolve_spawn_program(binary: &str) -> String {
    // Selected portable runtimes are explicit user choices. Resolve them
    // before PATH so every consumer uses the same executable after setup or
    // storage migration.
    if binary.eq_ignore_ascii_case("git") {
        if let Some(path) = crate::paths::configured_git_path().filter(|path| path.is_file()) {
            return path.to_string_lossy().into_owned();
        }
    }
    if binary.eq_ignore_ascii_case("node") {
        if let Some(path) = crate::paths::configured_node_path().filter(|path| path.is_file()) {
            return path.to_string_lossy().into_owned();
        }
    }
    let detected = detect_path(binary);
    if !detected.is_empty() {
        return detected;
    }
    if cfg!(windows) && Path::new(binary).extension().is_none() {
        for ext in [".cmd", ".exe", ".bat", ".com"] {
            let candidate = format!("{binary}{ext}");
            let detected = detect_path(&candidate);
            if !detected.is_empty() {
                return detected;
            }
        }
    }
    binary.to_string()
}

fn resolve_login_shell_env() -> Vec<(String, String)> {
    if cfg!(windows) {
        let mut env: Vec<(String, String)> = std::env::vars().collect();
        if !env.iter().any(|(key, _)| key.eq_ignore_ascii_case("HOME")) {
            if let Some(home) = home_dir() {
                env.push(("HOME".to_string(), home.to_string_lossy().into_owned()));
            }
        }
        return env;
    }

    let shell = default_shell_command();
    let output = std::process::Command::new(&shell.program)
        .args(&shell.args)
        .arg("-c")
        .arg("env")
        .output();
    match output {
        Ok(output) if output.status.success() => String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (key, value) = line.split_once('=')?;
                Some((key.to_string(), value.to_string()))
            })
            .collect(),
        _ => std::env::vars().collect(),
    }
}

fn find_on_windows_path(binary: &str, path_value: &str) -> Option<String> {
    find_all_on_windows_path(binary, path_value)
        .into_iter()
        .next()
}

fn find_all_on_windows_path(binary: &str, path_value: &str) -> Vec<String> {
    let has_extension = Path::new(binary).extension().is_some();
    let path_exts = if has_extension {
        vec![String::new()]
    } else {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .filter(|ext| !ext.is_empty())
            .map(|ext| ext.to_string())
            .collect::<Vec<_>>()
    };

    let mut matches = Vec::new();
    for dir in WindowsPathEntries::parse(path_value).iter() {
        if has_extension {
            let candidate = dir.join(binary);
            if candidate.is_file() {
                matches.push(candidate.to_string_lossy().into_owned());
            }
            continue;
        }
        for ext in &path_exts {
            let candidate = dir.join(format!("{binary}{ext}"));
            if candidate.is_file() {
                matches.push(candidate.to_string_lossy().into_owned());
                break;
            }
        }
    }
    matches
}

/// 用系统文件管理器打开路径。
pub fn open_in_explorer(path: &Path) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).output()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).output()
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).output()
    }
}

/// 应用平台特定参数：Windows 下隐藏子进程控制台窗口，其他平台无操作。
#[allow(dead_code)]
pub fn suppress_console_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd; // 非 Windows 平台避免未使用告警
}

#[cfg(test)]
mod tests {
    use super::{find_all_on_windows_path, WindowsPathEntries};
    use std::path::PathBuf;

    fn path_test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-windows-path-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn quoted_windows_path_keeps_old_node_and_spaced_node_24_candidates() {
        let root = path_test_root("node-candidates");
        let old_node_dir = root.join("node-20");
        let node_24_dir = root.join("Node Runtime 24");
        std::fs::create_dir_all(&old_node_dir).unwrap();
        std::fs::create_dir_all(&node_24_dir).unwrap();
        std::fs::write(old_node_dir.join("node.exe"), "old").unwrap();
        std::fs::write(node_24_dir.join("node.exe"), "new").unwrap();

        let node_24_case_variant = node_24_dir.to_string_lossy().to_uppercase();
        let path_value = format!(
            "  {} ; \"{}\" ; \"{}\" ; \"{}\" ; ",
            old_node_dir.display(),
            node_24_dir.display(),
            node_24_dir.display(),
            node_24_case_variant,
        );
        let entries = WindowsPathEntries::parse(&path_value)
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        let candidates = find_all_on_windows_path("node.exe", &path_value);

        assert_eq!(entries, vec![old_node_dir.clone(), node_24_dir.clone()]);
        assert_eq!(
            candidates,
            vec![
                old_node_dir.join("node.exe").to_string_lossy().into_owned(),
                node_24_dir.join("node.exe").to_string_lossy().into_owned(),
            ]
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn quoted_windows_path_finds_git_in_a_spaced_directory() {
        let root = path_test_root("git-candidate");
        let git_dir = root.join("Git For Windows").join("cmd");
        std::fs::create_dir_all(&git_dir).unwrap();
        let git = git_dir.join("git.exe");
        std::fs::write(&git, "git").unwrap();

        let candidates = find_all_on_windows_path("git.exe", &format!("\"{}\"", git_dir.display()));

        assert_eq!(candidates, vec![git.to_string_lossy().into_owned()]);
        let _ = std::fs::remove_dir_all(root);
    }
}
