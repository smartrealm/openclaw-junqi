/// 扫描用户 PATH，检测常见 AI CLI 和开发工具。

type Label = &'static str;
type Icon = &'static str;

const CANDIDATES: &[(&str, Label, Icon)] = &[
    // AI 助手：需要和 agent_task_pty::AGENTS 保持同步。
    // 图标由前端 icons.tsx 的 agent registry 解析。
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
    // 开发工具
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
    /// 不带换行的命令，供用户继续补参数。
    pub cmd_no_nl: String,
}

fn which(bin: &str) -> bool {
    !crate::platform::detect_path(bin).is_empty()
}

#[tauri::command]
pub async fn detect_cli_tools() -> Vec<CLIToolInfo> {
    // 放到阻塞线程中执行，避免 PATH 检测拖慢 Tauri 事件循环。
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
