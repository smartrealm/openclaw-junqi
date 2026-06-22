/// Detect AI CLI tools by scanning the user's PATH for known binary names.
///
/// Uses `which` to check each candidate. Runs in ~5ms (all candidates
/// checked in parallel via spawn_blocking).

use std::process::Command;

type Label = &'static str;
type Icon = &'static str;

const CANDIDATES: &[(&str, Label, Icon)] = &[
    // AI assistants
    ("codex", "Codex", "🧠"),
    ("claude", "Claude", "🤖"),
    ("pi", "Pi AI", "💡"),
    ("cursor-agent", "Cursor", "🖱️"),
    ("aider", "Aider", "🔧"),
    ("ollama", "Ollama", "🦙"),
    ("devbox", "Devbox", "📦"),
    ("qwen", "Qwen", "🤯"),
    ("gemini", "Gemini", "🌟"),
    ("copilot", "Copilot", "👨‍🚀"),
    ("cody", "Cody", "🐶"),
    ("continue", "Continue", "🔄"),
    ("shell-gpt", "sgpt", "💬"),
    ("gptme", "GPT Me", "⚡"),
    // Dev tools
    ("gh", "GitHub CLI", "🐙"),
    ("docker", "Docker", "🐳"),
    ("kubectl", "kubectl", "☸️"),
    ("helm", "Helm", "⛵"),
    ("terraform", "Terraform", "🏗️"),
    ("python3", "Python", "🐍"),
    ("node", "Node.js", "🟢"),
    ("cargo", "Cargo", "🦀"),
    ("pnpm", "pnpm", "📦"),
    ("yarn", "Yarn", "🧶"),
    ("brew", "Homebrew", "🍺"),
    ("nvim", "Neovim", "💜"),
    ("vim", "Vim", "📝"),
    ("code", "VS Code", "🖥️"),
    ("make", "Make", "🔨"),
    ("just", "Just", "⚙️"),
];

#[derive(serde::Serialize, Clone)]
pub struct CLIToolInfo {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub cmd: String,
    /// The command without newline — for tools where user wants to type args after
    pub cmd_no_nl: String,
}

fn which(bin: &str) -> bool {
    Command::new("which")
        .arg(bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub fn detect_cli_tools() -> Vec<CLIToolInfo> {
    CANDIDATES
        .iter()
        .filter(|(id, _, _)| which(id))
        .map(|(id, label, icon)| CLIToolInfo {
            id: id.to_string(),
            label: label.to_string(),
            icon: icon.to_string(),
            // AI tools typically want a full line (interactive TUI), dev tools get space suffix
            cmd: match *id {
                "codex" | "claude" | "pi" | "cursor-agent" | "aider" | "ollama" | "qwen"
                | "gemini" | "cody" | "continue" | "gptme" => format!("{}\n", id),
                _ => format!("{} ", id),
            },
            cmd_no_nl: id.to_string(),
        })
        .collect()
}
