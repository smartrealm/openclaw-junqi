//! 集中的路径辅助函数：应用内所有文件系统路径的单一来源。
//!
//! 任何模块需要路径时都应从这里导入，不要在业务代码里临时拼路径。

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const STORAGE_BOOTSTRAP_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StorageBootstrap {
    pub version: u32,
    pub state_dir: PathBuf,
    pub config_path: PathBuf,
    pub workspace_dir: PathBuf,
}

impl StorageBootstrap {
    pub fn for_state_dir(state_dir: PathBuf, workspace_dir: Option<PathBuf>) -> Self {
        let config_path = state_dir.join("openclaw.json");
        let workspace_dir = workspace_dir.unwrap_or_else(|| state_dir.join("workspace"));
        Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir,
            config_path,
            workspace_dir,
        }
    }
}

// ── 应用状态根目录 ────────────────────────────────────────────

fn home_dir_or_fallback() -> PathBuf {
    dirs::home_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| std::env::temp_dir().join("junqi"))
}

/// Stable location that is never stored inside the movable OpenClaw state dir.
pub fn storage_bootstrap_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home_dir_or_fallback().join(".config"))
        .join("com.junqi.junqidesktop")
        .join("bootstrap.json")
}

pub fn legacy_default_state_dir() -> PathBuf {
    home_dir_or_fallback().join(".openclaw")
}

pub fn load_storage_bootstrap() -> Option<StorageBootstrap> {
    let raw = std::fs::read_to_string(storage_bootstrap_path()).ok()?;
    let bootstrap: StorageBootstrap = serde_json::from_str(&raw).ok()?;
    if bootstrap.version != STORAGE_BOOTSTRAP_VERSION || !bootstrap.state_dir.is_absolute() {
        return None;
    }
    Some(bootstrap)
}

pub fn save_storage_bootstrap(bootstrap: &StorageBootstrap) -> Result<(), String> {
    if !bootstrap.state_dir.is_absolute()
        || !bootstrap.config_path.is_absolute()
        || !bootstrap.workspace_dir.is_absolute()
    {
        return Err("Storage paths must be absolute".to_string());
    }
    let path = storage_bootstrap_path();
    let parent = path.parent().ok_or("Invalid bootstrap path")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create bootstrap directory: {}", e))?;
    let tmp = parent.join(format!(".bootstrap-{}.tmp", std::process::id()));
    let raw = serde_json::to_string_pretty(bootstrap)
        .map_err(|e| format!("Failed to serialize bootstrap: {}", e))?;
    std::fs::write(&tmp, raw).map_err(|e| format!("Failed to write bootstrap: {}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("Failed to activate bootstrap: {}", e))
}

pub fn remove_storage_bootstrap() -> Result<(), String> {
    let path = storage_bootstrap_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove bootstrap: {}", e))?;
    }
    Ok(())
}

/// Return the selected OpenClaw state root. Explicit environment overrides
/// win, followed by JunQi's stable bootstrap, then the legacy default.
pub fn desktop_dir() -> PathBuf {
    std::env::var_os("OPENCLAW_STATE_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| load_storage_bootstrap().map(|b| b.state_dir))
        .unwrap_or_else(legacy_default_state_dir)
}

// ── 配置 ───────────────────────────────────────────────────────

/// 返回标准 OpenClaw 配置路径：`~/.openclaw/openclaw.json`。
pub fn config_path() -> PathBuf {
    std::env::var_os("OPENCLAW_CONFIG_PATH")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
        .or_else(|| load_storage_bootstrap().map(|b| b.config_path))
        .unwrap_or_else(|| desktop_dir().join("openclaw.json"))
}

// ── Node.js ────────────────────────────────────────────────────

/// 返回 JunQi 管理的 Node.js 二进制路径。
pub fn local_node_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("node").join("node.exe")
    } else {
        desktop_dir().join("node").join("bin").join("node")
    }
}

/// 返回 JunQi 管理的 Node.js 二进制所在目录。
pub fn node_bin_dir() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("node")
    } else {
        desktop_dir().join("node").join("bin")
    }
}

/// 返回 JunQi 管理的 Node 安装内的 npm-cli.js 路径。
pub fn local_npm_cli_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir()
            .join("node")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js")
    } else {
        desktop_dir()
            .join("node")
            .join("lib")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js")
    }
}

/// 返回 JunQi 管理的 npm 缓存目录。
pub fn npm_cache_dir() -> PathBuf {
    desktop_dir().join("npm-cache")
}

/// JunQi 自己安装 OpenClaw 时交给 `npm install -g` 的全局 prefix。
/// 这里刻意不使用 `desktop_dir().join("openclaw")`：旧的 `--prefix`
/// 写法会生成一套平行安装，遮蔽用户自己 `npm i -g openclaw` 的结果。
/// 现在使用真正的 npm 全局安装布局：
/// `~/.openclaw/global/lib/node_modules/openclaw`，并生成对应的可执行 shim。
pub fn openclaw_global_dir() -> PathBuf {
    desktop_dir().join("global")
}

/// 返回全局 prefix 下的可执行 shim 目录：
/// Unix 是 `<prefix>/bin`，Windows 是 `<prefix>`，因为 npm 会把
/// `openclaw.cmd` 放在 `node_modules` 旁边。
pub fn openclaw_global_bin_dir() -> PathBuf {
    if cfg!(windows) {
        openclaw_global_dir()
    } else {
        openclaw_global_dir().join("bin")
    }
}

/// XDG 兜底 prefix：当用户 npmrc 指向不可写位置时使用。
/// 典型例子包括 macOS/Homebrew 或 apt 默认的 `/usr/local`，
/// 以及 Windows 原生安装里的 `C:\Program Files\nodejs`。
/// `~/.local` 在目标平台上都属于当前用户，因此 `npm install -g`
/// 能可靠落盘；可执行文件在 Unix 上是 `~/.local/bin/openclaw`，
/// Windows 上是 `~/.local/openclaw.cmd`。
pub fn local_npm_prefix() -> PathBuf {
    home_dir_or_fallback().join(".local")
}

/// 返回 `local_npm_prefix()` 下的可执行 shim 目录：
/// Unix 是 `<prefix>/bin`，Windows 是 prefix 本身，因为
/// `openclaw.cmd` shim 就在 prefix 目录里。
pub fn local_npm_bin_dir() -> PathBuf {
    if cfg!(windows) {
        local_npm_prefix()
    } else {
        local_npm_prefix().join("bin")
    }
}

/// 从 `~/.npmrc` 读取用户自己的 npm 全局 prefix。
///
/// 优先使用用户 prefix，而不是 JunQi 自己的 `openclaw_global_dir()`，
/// 这样安装位置和用户在终端执行 `npm i -g openclaw` 完全一致：
/// 同一个 prefix、同一个可执行目录、同一个 `package.json`。
/// 用户之后也可以继续用自己的 npm 命令管理，不会被 JunQi 的影子安装覆盖。
///
/// 当 `~/.npmrc` 不存在、不可读或没有定义 `prefix` 时返回 `None`，
/// 调用方应继续回退到 JunQi 管理的位置。
pub fn user_npm_prefix() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let npmrc = home.join(".npmrc");
    let content = std::fs::read_to_string(&npmrc).ok()?;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let value = line
            .strip_prefix("prefix=")
            .or_else(|| line.strip_prefix("prefix ="))?;
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if value.is_empty() {
            return None;
        }
        return Some(PathBuf::from(value));
    }
    None
}

/// 返回用户执行 `npm i -g` 时可执行 shim 会写入的目录：
/// Unix 是 `<prefix>/bin`，Windows 是 prefix 本身，因为
/// `openclaw.cmd` shim 就在 prefix 目录里。
pub fn user_npm_bin_dir() -> Option<PathBuf> {
    let prefix = user_npm_prefix()?;
    if cfg!(windows) {
        Some(prefix)
    } else {
        Some(prefix.join("bin"))
    }
}

/// 保存安装/检测过程中选定的 OpenClaw 二进制。
/// 后续 Gateway 启动优先使用这个精确路径，避免在用户全局 npm、
/// 内置 wrapper、JunQi 管理安装之间漂移。
pub fn openclaw_binary_selection_path() -> PathBuf {
    desktop_dir().join("runtime").join("openclaw-binary.json")
}

// ── Git ────────────────────────────────────────────────────────

/// 返回 JunQi 本地安装的 Git 二进制路径（Windows 是 MinGit）。
pub fn local_git_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("git").join("cmd").join("git.exe")
    } else {
        desktop_dir().join("git").join("bin").join("git")
    }
}

/// 返回 JunQi 本地 Git 二进制所在目录。
pub fn git_bin_dir() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("git").join("cmd")
    } else {
        desktop_dir().join("git").join("bin")
    }
}

// ── 工作区 ─────────────────────────────────────────────────────

/// 默认工作区目录；用户未配置工作区时使用。
pub fn default_workspace_dir() -> PathBuf {
    load_storage_bootstrap()
        .map(|b| b.workspace_dir)
        .unwrap_or_else(|| desktop_dir().join("workspace"))
}

#[cfg(test)]
mod storage_bootstrap_tests {
    use super::*;

    #[test]
    fn bug_st01_layout_keeps_bootstrap_outside_state_dir() {
        let state = legacy_default_state_dir();
        assert!(!storage_bootstrap_path().starts_with(&state));
    }

    #[test]
    fn bug_st01_layout_derives_config_and_workspace() {
        let state = PathBuf::from("/tmp/junqi-storage-test");
        let layout = StorageBootstrap::for_state_dir(state.clone(), None);
        assert_eq!(layout.config_path, state.join("openclaw.json"));
        assert_eq!(layout.workspace_dir, state.join("workspace"));
    }
}

/// 从 openclaw.json 读取用户配置的工作区路径。
/// 配置不存在或未指定工作区时返回 None。
pub fn read_workspace_from_config(config_path: &std::path::Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let workspace = config
        .get("agents")?
        .get("defaults")?
        .get("workspace")?
        .as_str()?;
    Some(PathBuf::from(workspace))
}

// ── 设备 ───────────────────────────────────────────────────────

/// 返回保存配对状态的设备目录。
#[allow(dead_code)]
pub fn devices_dir() -> PathBuf {
    desktop_dir().join("devices")
}
