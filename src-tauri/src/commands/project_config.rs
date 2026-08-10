// ── JunQi project configuration ──────────────────────────────────────────────
//
// Manages `<project>/.junqi/config.toml` — per-project defaults for the agent
// (default agent, default permission mode, prompt prefix) and Git workflow
// (commit message prompt + timeout).
//
// Also reads/writes the global agent settings files:
//   - Claude Code:  ~/.claude/settings.json
//   - Codex:        ~/.codex/config.toml
//
use std::fs;
use std::path::Path;

const DEFAULT_COMMIT_MESSAGE_TIMEOUT_SECS: u64 = 15;

const DEFAULT_CONFIG: &str = r#"# JunQi project configuration

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

/// Creates `.junqi/config.toml` in the project directory if it doesn't already
/// exist. Also ensures `.junqi/attachments/` exists. Returns the parsed config.
#[tauri::command]
pub fn init_project_config(project_path: String) -> Result<ProjectConfig, String> {
    let junqi_dir = Path::new(&project_path).join(".junqi");
    let config_path = junqi_dir.join("config.toml");
    let attachments_dir = junqi_dir.join("attachments");

    fs::create_dir_all(&attachments_dir).map_err(|e| e.to_string())?;

    if !config_path.exists() {
        fs::write(&config_path, DEFAULT_CONFIG).map_err(|e| e.to_string())?;
    }

    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: ProjectConfig = toml::from_str(&raw).unwrap_or_default();

    Ok(config)
}

/// Reads `.junqi/config.toml` from the project directory.
/// Returns the default config if the file doesn't exist yet.
#[tauri::command]
pub fn read_project_config(project_path: String) -> Result<ProjectConfig, String> {
    let config_path = Path::new(&project_path).join(".junqi").join("config.toml");
    if !config_path.exists() {
        return Ok(ProjectConfig::default());
    }
    let raw = fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
    let config: ProjectConfig = toml::from_str(&raw).unwrap_or_default();
    Ok(config)
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
    fn project_config_uses_only_the_junqi_directory() {
        let root = std::env::temp_dir().join(format!(
            "junqi-project-config-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();

        init_project_config(root.to_string_lossy().into_owned()).unwrap();

        assert!(root.join(".junqi/config.toml").is_file());
        assert!(root.join(".junqi/attachments").is_dir());
        std::fs::remove_dir_all(root).unwrap();
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
}
