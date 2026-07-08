/// Detect AI CLI tools by scanning the user's PATH for known binary names.
///
/// Uses `which` to check each candidate. Runs in ~5ms (all candidates
/// checked in parallel via spawn_blocking).
use std::process::Command;

type Label = &'static str;
type Icon = &'static str;

const CANDIDATES: &[(&str, Label, Icon)] = &[
    // AI assistants (keep in sync with agent_task_pty::AGENTS)
    // icons resolved in frontend (WelcomePage) via icons.tsx agent registry
    ("claude", "Claude Code", ""),
    ("codex", "Codex", ""),
    ("gemini", "Gemini CLI", ""),
    ("cursor-agent", "Cursor CLI", ""),
    ("amp", "Amp", ""),
    ("copilot", "Copilot CLI", ""),
    ("grok", "Grok Build", ""),
    ("pi", "Pi", ""),
    ("kiro-cli", "Kiro CLI", ""),
    ("agy", "Antigravity CLI", ""),
    ("kimi", "Kimi Code", ""),
    ("opencode", "OpenCode", ""),
    ("aider", "Aider", ""),
    ("qwen", "Qwen CLI", ""),
    ("ollama", "Ollama", ""),
    ("cody", "Cody", ""),
    ("continue", "Continue", ""),
    ("shell-gpt", "sgpt", ""),
    ("gptme", "GPT Me", ""),
    ("devbox", "Devbox", ""),
    // Dev tools
    ("gh", "GitHub CLI", ""),
    ("docker", "Docker", ""),
    ("kubectl", "kubectl", ""),
    ("helm", "Helm", ""),
    ("terraform", "Terraform", ""),
    ("python3", "Python", ""),
    ("node", "Node.js", ""),
    ("cargo", "Cargo", ""),
    ("pnpm", "pnpm", ""),
    ("yarn", "Yarn", ""),
    ("brew", "Homebrew", ""),
    ("nvim", "Neovim", ""),
    ("vim", "Vim", ""),
    ("code", "VS Code", ""),
    ("make", "Make", ""),
    ("just", "Just", ""),
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
    // Platform-aware binary detection: `which` on Unix, `where` on Windows.
    #[cfg(target_os = "windows")]
    let (cmd, arg) = ("where", bin);
    #[cfg(not(target_os = "windows"))]
    let (cmd, arg) = ("which", bin);

    Command::new(cmd)
        .arg(arg)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn detect_cli_tools() -> Vec<CLIToolInfo> {
    // Run in a blocking thread so slow `which` calls don't starve the
    // Tauri event loop. Tauri automatically spawns async commands on a
    // thread pool — no explicit spawn_blocking needed for pure CPU work,
    // but `Command::output()` is I/O-bound so this ensures responsiveness.
    tokio::task::spawn_blocking(move || {
        CANDIDATES
            .iter()
            .filter(|(id, _, _)| which(id))
            .map(|(id, label, icon)| CLIToolInfo {
                id: id.to_string(),
                label: label.to_string(),
                icon: icon.to_string(),
                cmd: match *id {
                    "codex" | "claude" | "pi" | "cursor-agent" | "aider" | "ollama" | "qwen"
                    | "gemini" | "cody" | "continue" | "gptme" => format!("{}\n", id),
                    _ => format!("{} ", id),
                },
                cmd_no_nl: id.to_string(),
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}
