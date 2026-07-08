// ── Project config (ported from nezha config.rs) ─────────────────────────────
//
// Manages `<project>/.nezha/config.toml` — per-project defaults for the agent
// (default agent, default permission mode, prompt prefix) and Git workflow
// (commit message prompt + timeout).
//
// Also reads/writes the global agent settings files:
//   - Claude Code:  ~/.claude/settings.json
//   - Codex:        ~/.codex/config.toml
//
// Adapted differences from upstream nezha:
//   - `atomic_write` is inlined (junqi has no storage module).
//   - `home_dir` uses `dirs::home_dir()` directly (junqi exposes it via
//     `paths::desktop_dir()` which isn't a home-dir query).
//   - `crate::platform::home_dir` is not exposed; we use `dirs` directly.

use std::fs;
use std::path::Path;
use std::time::SystemTime;

const DEFAULT_COMMIT_MESSAGE_TIMEOUT_SECS: u64 = 15;

const DEFAULT_CONFIG: &str = r#"# Nezha project configuration
# https://github.com/hanshuaikang/nezha

[agent]
# Default agent to use for new tasks: "claude" or "codex"
default = "claude"
# Default permission mode for new tasks: "ask", "auto_edit", or "full_access"
default_permission_mode = "ask"
# Text automatically prepended (followed by a newline) to every task prompt
prompt_prefix = ""

[git]
# Prompt used when generating commit messages via the AI agent
commit_prompt = "You are a git commit message generator. Based on the provided git diff, write a concise and descriptive commit message. Follow these rules:\n1. Use the imperative mood (e.g., \"Add feature\" not \"Added feature\")\n2. First line: type(scope): short summary (50 chars or less)\n   Types: feat, fix, docs, style, refactor, test, chore\n3. If needed, add a blank line then a brief body explaining what and why\n4. Output ONLY the commit message text, no explanations or markdown formatting"
# Timeout in seconds when generating commit messages via the AI agent
commit_message_timeout_secs = 15
"#;

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct AgentConfig {
    pub default: String,
    #[serde(default = "default_permission_mode")]
    pub default_permission_mode: String,
    #[serde(default)]
    pub prompt_prefix: String,
}

fn default_permission_mode() -> String {
    "ask".to_string()
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct GitConfig {
    pub commit_prompt: String,
    #[serde(default = "default_commit_message_timeout_secs")]
    pub commit_message_timeout_secs: u64,
}

impl Default for GitConfig {
    fn default() -> Self {
        Self {
            commit_prompt: String::new(),
            commit_message_timeout_secs: default_commit_message_timeout_secs(),
        }
    }
}

fn default_commit_message_timeout_secs() -> u64 {
    DEFAULT_COMMIT_MESSAGE_TIMEOUT_SECS
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ProjectConfig {
    pub agent: AgentConfig,
    #[serde(default)]
    pub git: GitConfig,
}

impl Default for ProjectConfig {
    fn default() -> Self {
        ProjectConfig {
            agent: AgentConfig {
                default: "claude".to_string(),
                default_permission_mode: "ask".to_string(),
                prompt_prefix: String::new(),
            },
            git: GitConfig {
                commit_prompt: "You are a git commit message generator. Based on the provided git diff, write a concise and descriptive commit message. Follow these rules:\n1. Use the imperative mood (e.g., \"Add feature\" not \"Added feature\")\n2. First line: type(scope): short summary (50 chars or less)\n   Types: feat, fix, docs, style, refactor, test, chore\n3. If needed, add a blank line then a brief body explaining what and why\n4. Output ONLY the commit message text, no explanations or markdown formatting".to_string(),
                commit_message_timeout_secs: default_commit_message_timeout_secs(),
            },
        }
    }
}

/// Atomically writes `content` to `path` via a unique temp file + rename.
/// Temp file name includes pid + nanos timestamp so concurrent writes don't
/// collide. This matches the behavior of nezha's `storage::atomic_write`.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn home_dir() -> Result<std::path::PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())
}

fn agent_config_path(agent: &str) -> Result<std::path::PathBuf, String> {
    let home = home_dir()?;
    match agent {
        "claude" => Ok(home.join(".claude").join("settings.json")),
        "codex" => Ok(home.join(".codex").join("config.toml")),
        _ => Err(format!("Unknown agent: {}", agent)),
    }
}

/// Creates `.nezha/config.toml` in the project directory if it doesn't already
/// exist. Also ensures `.nezha/attachments/` exists. Returns the parsed config.
#[tauri::command]
pub fn init_project_config(project_path: String) -> Result<ProjectConfig, String> {
    let nezha_dir = Path::new(&project_path).join(".nezha");
    let config_path = nezha_dir.join("config.toml");
    let attachments_dir = nezha_dir.join("attachments");

    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    if !config_path.exists() {
        fs::write(&config_path, DEFAULT_CONFIG).map_err(|e| e.to_string())?;
    }

    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: ProjectConfig = toml::from_str(&raw).unwrap_or_default();

    Ok(config)
}

/// Reads `.nezha/config.toml` from the project directory.
/// Returns the default config if the file doesn't exist yet.
#[tauri::command]
pub fn read_project_config(project_path: String) -> Result<ProjectConfig, String> {
    let config_path = Path::new(&project_path).join(".nezha").join("config.toml");
    if !config_path.exists() {
        return Ok(ProjectConfig::default());
    }
    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: ProjectConfig = toml::from_str(&raw).unwrap_or_default();
    Ok(config)
}

/// Writes updated config to `.nezha/config.toml`, creating the directory if needed.
#[tauri::command]
pub fn write_project_config(project_path: String, config: ProjectConfig) -> Result<(), String> {
    let nezha_dir = Path::new(&project_path).join(".nezha");
    fs::create_dir_all(&nezha_dir).map_err(|e| e.to_string())?;
    let config_path = nezha_dir.join("config.toml");
    let raw = toml::to_string_pretty(&config).map_err(|e| e.to_string())?;
    atomic_write(&config_path, &raw)
}

#[tauri::command]
pub fn get_agent_config_file_path(agent: String) -> Result<String, String> {
    Ok(agent_config_path(&agent)?.to_string_lossy().into_owned())
}

/// Reads the local settings file for the given agent ("claude" or "codex").
/// Returns None if the file doesn't exist.
#[tauri::command]
pub fn read_agent_config_file(agent: String) -> Result<Option<String>, String> {
    let path = agent_config_path(&agent)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Writes raw content back to the agent's local settings file.
#[tauri::command]
pub fn write_agent_config_file(agent: String, content: String) -> Result<(), String> {
    let path = agent_config_path(&agent)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    atomic_write(&path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_claude_agent_and_ask_mode() {
        let cfg = ProjectConfig::default();
        assert_eq!(cfg.agent.default, "claude");
        assert_eq!(cfg.agent.default_permission_mode, "ask");
        assert_eq!(cfg.agent.prompt_prefix, "");
    }

    #[test]
    fn default_commit_timeout_is_15_seconds() {
        assert_eq!(default_commit_message_timeout_secs(), 15);
    }

    #[test]
    fn toml_round_trip_preserves_all_fields() {
        let original = ProjectConfig {
            agent: AgentConfig {
                default: "codex".to_string(),
                default_permission_mode: "auto_edit".to_string(),
                prompt_prefix: "You are a codex agent.".to_string(),
            },
            git: GitConfig {
                commit_prompt: "Write a concise message.".to_string(),
                commit_message_timeout_secs: 45,
            },
        };
        let serialized = toml::to_string_pretty(&original).expect("serialize");
        let parsed: ProjectConfig = toml::from_str(&serialized).expect("parse");
        assert_eq!(parsed.agent.default, "codex");
        assert_eq!(parsed.agent.default_permission_mode, "auto_edit");
        assert_eq!(parsed.agent.prompt_prefix, "You are a codex agent.");
        assert_eq!(parsed.git.commit_prompt, "Write a concise message.");
        assert_eq!(parsed.git.commit_message_timeout_secs, 45);
    }

    #[test]
    fn missing_optional_fields_fall_back_to_defaults() {
        let minimal = r#"
            [agent]
            default = "claude"
        "#;
        let cfg: ProjectConfig = toml::from_str(minimal).expect("parse minimal");
        assert_eq!(cfg.agent.default, "claude");
        assert_eq!(cfg.agent.default_permission_mode, "ask");
        assert_eq!(cfg.agent.prompt_prefix, "");
        assert_eq!(cfg.git.commit_message_timeout_secs, 15);
    }

    #[test]
    fn atomic_write_creates_file_with_expected_content() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-project-config-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        let payload = "key = \"value\"\n";
        atomic_write(&path, payload).expect("atomic_write");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), payload);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn atomic_write_overwrites_existing_file() {
        let dir = std::env::temp_dir().join(format!(
            "junqi-project-config-overwrite-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        atomic_write(&path, "old").unwrap();
        atomic_write(&path, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
