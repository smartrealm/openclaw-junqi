//! 集中的路径辅助函数：应用内所有文件系统路径的单一来源。
//!
//! 任何模块需要路径时都应从这里导入，不要在业务代码里临时拼路径。

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const STORAGE_BOOTSTRAP_VERSION: u32 = 5;

/// The OpenClaw runtime selected by the user during setup.
///
/// This belongs beside the storage bootstrap instead of a frontend cache: the
/// active Gateway configuration must survive a desktop restart and be shared by
/// setup, Gateway recovery, and the configuration UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpenClawRuntimeMode {
    Native,
    Docker,
}

impl Default for OpenClawRuntimeMode {
    fn default() -> Self {
        Self::Native
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageBootstrap {
    pub version: u32,
    pub state_dir: PathBuf,
    pub config_path: PathBuf,
    pub workspace_dir: PathBuf,
    pub runtime_dir: PathBuf,
    /// An explicitly user-selected npm cache directory. `None` leaves cache
    /// resolution to npm for the current system user.
    pub npm_cache_dir: Option<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
    /// An explicitly user-selected portable Node.js root. `None` means use
    /// the operating-system installation discovered at runtime.
    pub node_runtime_dir: Option<PathBuf>,
    /// An explicitly user-selected portable Git root. `None` means use the
    /// operating-system installation discovered at runtime.
    pub git_runtime_dir: Option<PathBuf>,
    pub terminal_integration: bool,
    pub runtime_mode: OpenClawRuntimeMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedStorageBootstrap {
    version: u32,
    state_dir: PathBuf,
    config_path: PathBuf,
    workspace_dir: PathBuf,
    #[serde(default)]
    runtime_dir: Option<PathBuf>,
    #[serde(default)]
    npm_cache_dir: Option<PathBuf>,
    #[serde(default)]
    npm_prefix: Option<PathBuf>,
    #[serde(default)]
    node_runtime_dir: Option<PathBuf>,
    #[serde(default)]
    git_runtime_dir: Option<PathBuf>,
    #[serde(default)]
    terminal_integration: bool,
    #[serde(default)]
    runtime_mode: OpenClawRuntimeMode,
}

impl StorageBootstrap {
    pub fn for_state_dir(state_dir: PathBuf, workspace_dir: Option<PathBuf>) -> Self {
        let config_path = state_dir.join("openclaw.json");
        let workspace_dir = workspace_dir.unwrap_or_else(|| state_dir.join("workspace"));
        Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            runtime_dir: state_dir.clone(),
            state_dir,
            config_path,
            workspace_dir,
            npm_cache_dir: None,
            npm_prefix: None,
            node_runtime_dir: None,
            git_runtime_dir: None,
            terminal_integration: false,
            runtime_mode: OpenClawRuntimeMode::Native,
        }
    }

    pub fn with_locations(
        state_dir: PathBuf,
        workspace_dir: PathBuf,
        runtime_dir: PathBuf,
        npm_cache_dir: Option<PathBuf>,
        npm_prefix: Option<PathBuf>,
        terminal_integration: bool,
    ) -> Self {
        Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            config_path: state_dir.join("openclaw.json"),
            state_dir,
            workspace_dir,
            runtime_dir,
            npm_cache_dir,
            npm_prefix,
            node_runtime_dir: None,
            git_runtime_dir: None,
            terminal_integration,
            runtime_mode: OpenClawRuntimeMode::Native,
        }
    }

    fn from_persisted(value: PersistedStorageBootstrap) -> Option<Self> {
        if value.version == 0 || value.version > STORAGE_BOOTSTRAP_VERSION {
            return None;
        }
        let runtime_dir = value.runtime_dir.unwrap_or_else(|| value.state_dir.clone());
        // Versions before v5 represented "use npm's default" with a JunQi
        // owned `state_dir/npm-cache` path. Normalize that legacy marker to
        // `None`, while keeping any genuinely custom cache selection intact.
        let legacy_cache_marker = value.state_dir.join("npm-cache");
        let npm_cache_dir = if value.version < STORAGE_BOOTSTRAP_VERSION {
            value
                .npm_cache_dir
                .filter(|path| path != &legacy_cache_marker)
        } else {
            value.npm_cache_dir
        };
        let normalized = Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir: value.state_dir,
            config_path: value.config_path,
            workspace_dir: value.workspace_dir,
            runtime_dir,
            npm_cache_dir,
            npm_prefix: value.npm_prefix,
            node_runtime_dir: value.node_runtime_dir,
            git_runtime_dir: value.git_runtime_dir,
            terminal_integration: value.terminal_integration,
            runtime_mode: value.runtime_mode,
        };
        normalized.paths_are_absolute().then_some(normalized)
    }

    fn to_persisted(&self) -> PersistedStorageBootstrap {
        PersistedStorageBootstrap {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir: self.state_dir.clone(),
            config_path: self.config_path.clone(),
            workspace_dir: self.workspace_dir.clone(),
            runtime_dir: Some(self.runtime_dir.clone()),
            npm_cache_dir: self.npm_cache_dir.clone(),
            npm_prefix: self.npm_prefix.clone(),
            node_runtime_dir: self.node_runtime_dir.clone(),
            git_runtime_dir: self.git_runtime_dir.clone(),
            terminal_integration: self.terminal_integration,
            runtime_mode: self.runtime_mode,
        }
    }

    fn paths_are_absolute(&self) -> bool {
        self.state_dir.is_absolute()
            && self.config_path.is_absolute()
            && self.workspace_dir.is_absolute()
            && self.runtime_dir.is_absolute()
            && self
                .npm_cache_dir
                .as_ref()
                .is_none_or(|path| path.is_absolute())
            && self
                .npm_prefix
                .as_ref()
                .is_none_or(|path| path.is_absolute())
            && self
                .node_runtime_dir
                .as_ref()
                .is_none_or(|path| path.is_absolute())
            && self
                .git_runtime_dir
                .as_ref()
                .is_none_or(|path| path.is_absolute())
    }
}

// ── 应用状态根目录 ────────────────────────────────────────────

fn home_dir_or_fallback() -> PathBuf {
    dirs::home_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| std::env::temp_dir().join("junqi"))
}

/// Stable location that is never stored inside the movable OpenClaw state dir.
pub fn app_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home_dir_or_fallback().join(".config"))
        .join("com.junqi.junqidesktop")
}

pub fn storage_bootstrap_path() -> PathBuf {
    app_config_dir().join("bootstrap.json")
}

pub fn legacy_default_state_dir() -> PathBuf {
    home_dir_or_fallback().join(".openclaw")
}

pub fn load_storage_bootstrap() -> Option<StorageBootstrap> {
    let raw = std::fs::read_to_string(storage_bootstrap_path()).ok()?;
    let persisted: PersistedStorageBootstrap = serde_json::from_str(&raw).ok()?;
    StorageBootstrap::from_persisted(persisted)
}

pub fn save_storage_bootstrap(bootstrap: &StorageBootstrap) -> Result<(), String> {
    if !bootstrap.paths_are_absolute() {
        return Err("Storage paths must be absolute".to_string());
    }
    let path = storage_bootstrap_path();
    write_storage_bootstrap(&path, bootstrap)
}

fn write_storage_bootstrap(path: &Path, bootstrap: &StorageBootstrap) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&bootstrap.to_persisted())
        .map_err(|e| format!("Failed to serialize bootstrap: {}", e))?;
    atomic_write_text(path, &raw).map_err(|error| format!("Failed to write bootstrap: {}", error))
}

pub(crate) fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid atomic write path")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let tmp = parent.join(format!(
        ".{}-{}-{}.tmp",
        file_name,
        std::process::id(),
        suffix
    ));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to write temporary file: {}", error));
    }
    if let Err(error) = replace_file(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to replace destination: {}", error));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
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

/// Resolve the configuration location inside a state root for a specific
/// runtime. Storage migration uses this instead of assuming that every active
/// configuration is the Native `openclaw.json` file.
pub fn config_path_for_runtime(state_dir: &Path, mode: OpenClawRuntimeMode) -> PathBuf {
    match mode {
        OpenClawRuntimeMode::Native => state_dir.join("openclaw.json"),
        OpenClawRuntimeMode::Docker => state_dir.join("docker").join("openclaw.json"),
    }
}

/// The isolated configuration mounted into the OpenClaw Docker container.
pub fn docker_config_path() -> PathBuf {
    config_path_for_runtime(&desktop_dir(), OpenClawRuntimeMode::Docker)
}

/// The runtime selected during setup. Legacy bootstrap files remain native by
/// default so upgrading JunQi never changes an existing user's runtime.
pub fn active_runtime_mode() -> OpenClawRuntimeMode {
    load_storage_bootstrap()
        .map(|layout| layout.runtime_mode)
        .unwrap_or_default()
}

/// Resolve the authoritative OpenClaw configuration for the selected runtime.
/// Native-only process commands must continue to call `config_path()` directly.
pub fn active_config_path() -> PathBuf {
    match active_runtime_mode() {
        OpenClawRuntimeMode::Native => config_path(),
        OpenClawRuntimeMode::Docker => docker_config_path(),
    }
}

/// Persist an explicit runtime choice. Runtime selection is only valid after
/// storage setup, which guarantees that the choice has a stable home.
pub fn set_active_runtime_mode(mode: OpenClawRuntimeMode) -> Result<(), String> {
    let mut layout = load_storage_bootstrap()
        .ok_or("Storage setup must be completed before selecting an OpenClaw runtime")?;
    layout.runtime_mode = mode;
    save_storage_bootstrap(&layout)
}

// ── Node.js ────────────────────────────────────────────────────

/// Returns a user-selected portable Node.js root. Without an explicit
/// selection, JunQi deliberately uses the system installation rather than
/// creating another Node.js copy beside OpenClaw data.
pub fn configured_node_runtime_dir() -> Option<PathBuf> {
    std::env::var_os("JUNQI_NODE_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.node_runtime_dir))
}

fn node_binary_in(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("node.exe")
    } else {
        root.join("bin").join("node")
    }
}

fn npm_cli_in_node_root(root: &Path) -> PathBuf {
    let npm_root = if cfg!(windows) {
        root.join("node_modules")
    } else {
        root.join("lib").join("node_modules")
    };
    npm_root.join("npm").join("bin").join("npm-cli.js")
}

/// The explicit portable Node.js executable, if the user opted into one.
pub fn configured_node_path() -> Option<PathBuf> {
    configured_node_runtime_dir().map(|root| node_binary_in(&root))
}

/// The portable Node.js location used by older JunQi releases. This remains a
/// read-only compatibility fallback; new setup flows never install here unless
/// the user explicitly selected that same directory.
pub fn legacy_local_node_path() -> PathBuf {
    node_binary_in(&runtime_dir().join("node"))
}

/// The npm CLI that belongs to an explicitly selected portable Node.js.
pub fn configured_npm_cli_path() -> Option<PathBuf> {
    configured_node_runtime_dir().map(|root| npm_cli_in_node_root(&root))
}

/// The legacy private npm CLI kept only for upgrades from older releases.
pub fn legacy_local_npm_cli_path() -> PathBuf {
    let legacy_root = runtime_dir().join("node");
    npm_cli_in_node_root(&legacy_root)
}

/// Return an npm cache override only when the user explicitly selected one.
/// Otherwise npm owns its platform-native cache path and can react to changes
/// in the user's own Node.js/npm configuration.
pub fn configured_npm_cache_dir() -> Option<PathBuf> {
    load_storage_bootstrap().and_then(|layout| layout.npm_cache_dir)
}

pub fn runtime_dir() -> PathBuf {
    if std::env::var_os("OPENCLAW_STATE_DIR").is_some() {
        return desktop_dir();
    }
    load_storage_bootstrap()
        .map(|layout| layout.runtime_dir)
        .unwrap_or_else(desktop_dir)
}

pub fn configured_npm_prefix() -> Option<PathBuf> {
    std::env::var_os("JUNQI_NPM_PREFIX")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.npm_prefix))
}

pub fn terminal_integration_requested() -> bool {
    load_storage_bootstrap()
        .map(|layout| layout.terminal_integration)
        .unwrap_or(false)
}

pub fn terminal_launcher_dir() -> PathBuf {
    app_config_dir().join("bin")
}

/// 返回全局 prefix 下的可执行 shim 目录：
/// Unix 是 `<prefix>/bin`，Windows 是 `<prefix>`，因为 npm 会把
/// `openclaw.cmd` 放在 `node_modules` 旁边。
pub fn npm_bin_dir_for_prefix(prefix: &Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

/// 从 `~/.npmrc` 读取用户自己的 npm 全局 prefix。
///
/// 这样安装位置和用户在终端执行 `npm i -g openclaw` 完全一致：
/// 同一个 prefix、同一个可执行目录、同一个 `package.json`。
/// 用户之后也可以继续用自己的 npm 命令管理，不会被 JunQi 的平行安装覆盖。
///
/// 当 `~/.npmrc` 不存在、不可读或没有定义 `prefix` 时返回 `None`，
/// 调用方应查询 npm 的实际有效配置或要求用户明确选择前缀。
pub fn user_npm_prefix() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let npmrc = home.join(".npmrc");
    let content = std::fs::read_to_string(&npmrc).ok()?;
    user_npm_prefix_from_npmrc(&content)
}

fn user_npm_prefix_from_npmrc(content: &str) -> Option<PathBuf> {
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(value) = line
            .strip_prefix("prefix=")
            .or_else(|| line.strip_prefix("prefix ="))
        else {
            continue;
        };
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if value.is_empty() {
            continue;
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
    Some(npm_bin_dir_for_prefix(&prefix))
}

/// 保存安装/检测过程中选定的 OpenClaw 二进制。
/// 后续 Gateway 启动优先使用这个精确路径，避免在用户全局 npm、
/// 内置 wrapper、JunQi 管理安装之间漂移。
pub fn openclaw_binary_selection_path() -> PathBuf {
    desktop_dir().join("runtime").join("openclaw-binary.json")
}

// ── Git ────────────────────────────────────────────────────────

/// Returns a user-selected portable Git root. Without an explicit selection,
/// Git is discovered from the operating system and its configured PATH.
pub fn configured_git_runtime_dir() -> Option<PathBuf> {
    std::env::var_os("JUNQI_GIT_RUNTIME_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.git_runtime_dir))
}

fn git_binary_in(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("cmd").join("git.exe")
    } else {
        root.join("bin").join("git")
    }
}

pub fn configured_git_path() -> Option<PathBuf> {
    configured_git_runtime_dir().map(|root| git_binary_in(&root))
}

/// Legacy JunQi-owned Git remains discoverable after an upgrade, but new
/// default setup never writes to this location.
pub fn legacy_local_git_path() -> PathBuf {
    git_binary_in(&runtime_dir().join("git"))
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

    #[test]
    fn npmrc_prefix_parser_continues_past_unrelated_settings() {
        let content =
            "registry=https://registry.npmmirror.com\nstrict-ssl=false\nprefix = /custom/npm\n";
        assert_eq!(
            user_npm_prefix_from_npmrc(content),
            Some(PathBuf::from("/custom/npm"))
        );
    }

    #[test]
    fn custom_dependency_runtime_dirs_are_explicit_and_survive_bootstrap_round_trip() {
        let root = std::env::temp_dir().join("junqi-runtime-selection-test");
        let state = root.join("state");
        let node = root.join("selected-node");
        let git = root.join("selected-git");
        let mut layout = StorageBootstrap::for_state_dir(state, None);
        layout.node_runtime_dir = Some(node.clone());
        layout.git_runtime_dir = Some(git.clone());

        let restored = StorageBootstrap::from_persisted(layout.to_persisted()).unwrap();
        assert_eq!(restored.node_runtime_dir, Some(node));
        assert_eq!(restored.git_runtime_dir, Some(git));
        assert_ne!(
            restored.node_runtime_dir,
            Some(restored.runtime_dir.join("node"))
        );
        assert_ne!(
            restored.git_runtime_dir,
            Some(restored.runtime_dir.join("git"))
        );
    }

    #[test]
    fn bug_st06_bootstrap_replaces_an_existing_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-bootstrap-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("bootstrap.json");
        let first = StorageBootstrap::for_state_dir(root.join("first"), None);
        let second = StorageBootstrap::for_state_dir(root.join("second"), None);

        write_storage_bootstrap(&path, &first).unwrap();
        write_storage_bootstrap(&path, &second).unwrap();

        let saved_record: PersistedStorageBootstrap =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let saved = StorageBootstrap::from_persisted(saved_record).unwrap();
        assert_eq!(saved, second);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn v1_bootstrap_moves_legacy_cache_marker_back_to_npm_default() {
        let state = std::env::temp_dir().join("junqi-v1-layout");
        let raw = serde_json::json!({
            "version": 1,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace")
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();
        assert_eq!(layout.runtime_dir, state);
        assert_eq!(layout.npm_cache_dir, None);
        assert_eq!(layout.npm_prefix, None);
        assert!(!layout.terminal_integration);
        assert_eq!(layout.runtime_mode, OpenClawRuntimeMode::Native);
    }

    #[test]
    fn fresh_bootstrap_does_not_persist_an_npm_cache_override() {
        let state = std::env::temp_dir().join("junqi-native-npm-cache-default");
        let layout = StorageBootstrap::for_state_dir(state, None);

        assert_eq!(layout.npm_cache_dir, None);
        assert_eq!(layout.to_persisted().npm_cache_dir, None);
    }

    #[test]
    fn v4_custom_npm_cache_survives_the_native_default_migration() {
        let state = std::env::temp_dir().join("junqi-v4-layout");
        let custom_cache = state.with_file_name("custom-npm-cache");
        let raw = serde_json::json!({
            "version": 4,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "npm_cache_dir": custom_cache
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();
        assert_eq!(layout.npm_cache_dir, Some(custom_cache));
    }

    #[test]
    fn bug_rt01_runtime_selection_survives_bootstrap_round_trip() {
        let state = std::env::temp_dir().join("junqi-runtime-selection");
        let mut layout = StorageBootstrap::for_state_dir(state, None);
        layout.runtime_mode = OpenClawRuntimeMode::Docker;

        let restored = StorageBootstrap::from_persisted(layout.to_persisted()).unwrap();
        assert_eq!(restored.runtime_mode, OpenClawRuntimeMode::Docker);
    }

    #[test]
    fn bug_st06_failed_bootstrap_activation_removes_temporary_file() {
        let root = std::env::temp_dir().join(format!(
            "junqi-bootstrap-failure-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let path = root.join("bootstrap.json");
        std::fs::create_dir_all(&path).unwrap();
        let layout = StorageBootstrap::for_state_dir(root.join("state"), None);

        assert!(write_storage_bootstrap(&path, &layout).is_err());
        let entries = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec![std::ffi::OsString::from("bootstrap.json")]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bug_st07_workspace_paths_match_openclaw_resolution() {
        let home = Path::new("/users/tester");
        let cwd = Path::new("/work/junqi");

        assert_eq!(
            resolve_openclaw_user_path_from(" ~/agents/main ", home, cwd).unwrap(),
            home.join("agents/main")
        );
        assert_eq!(
            resolve_openclaw_user_path_from("./workspace/../agent-data", home, cwd).unwrap(),
            cwd.join("agent-data")
        );
    }
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn resolve_openclaw_user_path_from(raw: &str, home: &Path, cwd: &Path) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("OpenClaw path cannot be empty".to_string());
    }

    let expanded = if trimmed == "~" {
        home.to_path_buf()
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        home.join(trimmed[2..].trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(trimmed)
    };
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };
    Ok(normalize_absolute_path(&absolute))
}

/// Match OpenClaw's `resolveUserPath`: trim, expand `~`, then resolve relative
/// paths from the process working directory without requiring the path to exist.
pub fn resolve_openclaw_user_path(raw: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve the user home directory")?;
    let cwd = std::env::current_dir()
        .map_err(|error| format!("Unable to resolve the current directory: {}", error))?;
    resolve_openclaw_user_path_from(raw, &home, &cwd)
}

/// 从 openclaw.json 读取并解析用户配置的工作区路径。
/// 配置不存在、无效或未指定工作区时返回 None。
pub fn read_workspace_from_config(config_path: &std::path::Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let workspace = config
        .get("agents")?
        .get("defaults")?
        .get("workspace")?
        .as_str()?;
    resolve_openclaw_user_path(workspace).ok()
}

// ── 设备 ───────────────────────────────────────────────────────

/// 返回保存配对状态的设备目录。
#[allow(dead_code)]
pub fn devices_dir() -> PathBuf {
    desktop_dir().join("devices")
}
