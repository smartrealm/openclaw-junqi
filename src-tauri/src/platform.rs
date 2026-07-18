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
/// Windows installers update the live process PATH through
/// `refresh_path_from_registry`; a startup-only OnceLock would keep using the
/// pre-install value for npm/Git/Node probes.
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
    for dir in path_value
        .split(';')
        .filter(|segment| !segment.trim().is_empty())
    {
        if has_extension {
            let candidate = Path::new(dir).join(binary);
            if candidate.is_file() {
                matches.push(candidate.to_string_lossy().into_owned());
            }
            continue;
        }
        for ext in &path_exts {
            let candidate = Path::new(dir).join(format!("{binary}{ext}"));
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
