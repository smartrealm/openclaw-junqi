/// Detect which AI CLI tools are installed on the user's machine.
/// Used by the terminal quick-launch bar to only show available tools.

use std::process::Command;

const CANDIDATES: &[(&str, &str, &str)] = &[
    ("codex", "OpenAI Codex CLI", "🧠"),
    ("claude", "Anthropic Claude CLI", "🤖"),
    ("pi", "Pi AI CLI", "💡"),
    ("cursor-agent", "Cursor Agent", "🖱️"),
    ("ollama", "Ollama (local LLM)", "🦙"),
    ("aider", "Aider AI pair programmer", "🔧"),
    ("gh", "GitHub CLI", "🐙"),
    ("docker", "Docker CLI", "🐳"),
];

#[derive(serde::Serialize, Clone)]
pub struct CLIToolInfo {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub cmd: String,
}

#[tauri::command]
pub fn detect_cli_tools() -> Vec<CLIToolInfo> {
    CANDIDATES
        .iter()
        .filter_map(|(id, label, icon)| {
            let found = Command::new("which")
                .arg(id)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if found {
                Some(CLIToolInfo {
                    id: id.to_string(),
                    label: label.to_string(),
                    icon: icon.to_string(),
                    cmd: format!("{}\n", id),
                })
            } else {
                None
            }
        })
        .collect()
}
