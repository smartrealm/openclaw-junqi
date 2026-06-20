// ── Port of nezha git.rs into commands module with _neu suffix ─────────────────
// All #[tauri::command] functions are preserved. Crate references changed to
// match the host project's crate structure: nezha modules live under crate::nezha::.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};

// ── Inlined platform helpers (avoiding deep nezha dependency chain) ──────────

#[cfg(windows)]
fn configure_background_command(cmd: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn configure_background_command(_cmd: &mut std::process::Command) {}

#[cfg(windows)]
fn configure_background_tokio_command(cmd: &mut tokio::process::Command) {
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn configure_background_tokio_command(_cmd: &mut tokio::process::Command) {}

/// Returns the login shell environment variables for agent subprocesses.
fn get_login_shell_env() -> Vec<(String, String)> {
    // On macOS/Linux, respect the user's login shell environment.
    // For simplicity, we return an empty vec (subprocess config lives in nezha's
    // app_settings.rs which has a complex dependency chain).
    #[cfg(target_os = "macos")]
    {
        // macOS: read the user's default shell environment
        if let Ok(output) = std::process::Command::new("/usr/bin/env")
            .arg("-i")
            .arg("/bin/zsh")
            .arg("-lc")
            .arg("env")
            .output()
        {
            if output.status.success() {
                return String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter_map(|line| {
                        let (key, value) = line.split_once('=')?;
                        Some((key.to_string(), value.to_string()))
                    })
                    .collect();
            }
        }
    }
    Vec::new()
}

/// Minimal agent launch spec for commit message generation.
struct AgentLaunchSpec {
    program: String,
    extra_env: Vec<(String, String)>,
}

fn get_agent_launch_spec_helper(agent: &str) -> AgentLaunchSpec {
    match agent {
        "codex" => AgentLaunchSpec {
            program: "codex".to_string(),
            extra_env: Vec::new(),
        },
        "claude" => AgentLaunchSpec {
            program: "claude".to_string(),
            extra_env: Vec::new(),
        },
        _ => AgentLaunchSpec {
            program: "claude".to_string(),
            extra_env: Vec::new(),
        },
    }
}

/// Stub: reads the project config commit prompt. Returns default values.
struct GitConfig {
    commit_prompt: String,
    commit_message_timeout_secs: u64,
}

struct AgentConfig {
    default: String,
}

struct ProjectConfig {
    git: GitConfig,
    agent: AgentConfig,
}

fn read_project_config_helper(_project_path: String) -> Result<ProjectConfig, String> {
    // Without nezha's full config system, provide reasonable defaults.
    // The nezha config is stored alongside the project but has deep dependencies.
    // For now, use hardcoded defaults so the git commands work standalone.
    Ok(ProjectConfig {
        git: GitConfig {
            commit_prompt: "Write a concise, conventional commit message for the following diff. Follow the Conventional Commits format (feat:, fix:, refactor:, docs:, chore:, etc.).".to_string(),
            commit_message_timeout_secs: 30,
        },
        agent: AgentConfig {
            default: "claude".to_string(),
        },
    })
}

// ── Helper functions ─────────────────────────────────────────────────────────

/// Validate that project_path is absolute and looks like a real project directory.
fn validate_project_path(project_path: &str) -> Result<(), String> {
    let path = Path::new(project_path);
    if !path.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    if !path.exists() {
        return Err("Project path does not exist".to_string());
    }
    // Resolve symlinks / .. and ensure the path didn't escape
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project path: {}", e))?;
    if canonical != path {
        // Allow symlinks that resolve to a valid directory, but block obvious traversal
        if !canonical.is_dir() {
            return Err("Project path is not a directory".to_string());
        }
    }
    Ok(())
}

/// Execute a git command and return raw Output.
fn run_git<S: AsRef<std::ffi::OsStr>>(
    project_path: &str,
    args: &[S],
) -> Result<std::process::Output, String> {
    validate_project_path(project_path)?;

    let mut cmd = std::process::Command::new("git");
    configure_background_command(&mut cmd);
    cmd.args(args)
        .current_dir(project_path)
        .output()
        .map_err(|e| e.to_string())
}

async fn read_pipe_to_end<R: AsyncRead + Unpin>(
    mut pipe: R,
    stream_name: &str,
) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    pipe.read_to_end(&mut data)
        .await
        .map_err(|e| format!("Failed to read git {}: {}", stream_name, e))?;
    Ok(data)
}

/// Git command with timeout.
/// Kills the underlying git child process on timeout to prevent process/thread accumulation.
async fn run_git_with_timeout(
    project_path: String,
    args: Vec<String>,
    timeout: Duration,
) -> Result<Output, String> {
    validate_project_path(&project_path)?;

    let mut cmd = tokio::process::Command::new("git");
    configure_background_tokio_command(&mut cmd);
    let mut child = cmd
        .args(&args)
        .current_dir(&project_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture git stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture git stderr".to_string())?;

    let stdout_task = tokio::spawn(read_pipe_to_end(stdout, "stdout"));
    let stderr_task = tokio::spawn(read_pipe_to_end(stderr, "stderr"));

    let status = match tokio::time::timeout(timeout, child.wait()).await {
        Ok(result) => result.map_err(|e| e.to_string())?,
        Err(_) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(1), child.wait()).await;
            stdout_task.abort();
            stderr_task.abort();
            let _ = stdout_task.await;
            let _ = stderr_task.await;
            return Err(format!("Git command timed out ({}s)", timeout.as_secs()));
        }
    };

    let stdout = stdout_task
        .await
        .map_err(|e| format!("Git stdout task failed: {}", e))??;
    let stderr = stderr_task
        .await
        .map_err(|e| format!("Git stderr task failed: {}", e))??;

    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

/// Run git and return error from stderr if exit code is non-zero.
fn run_git_check<S: AsRef<std::ffi::OsStr>>(project_path: &str, args: &[S]) -> Result<(), String> {
    let output = run_git(project_path, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(())
}

fn git_command_error(output: &Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let message = format!("{}{}", stderr, stdout).trim().to_string();
    if message.is_empty() {
        fallback.to_string()
    } else {
        message
    }
}

fn validate_git_relative_path(relative_path: &str) -> Result<(), String> {
    if relative_path.is_empty() {
        return Err("File path must not be empty".to_string());
    }

    let path = Path::new(relative_path);
    if path.is_absolute() {
        return Err("File path must be relative".to_string());
    }

    for component in path.components() {
        match component {
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err("File path must stay inside the git worktree".to_string());
            }
            _ => {}
        }
    }

    Ok(())
}

fn unique_git_file_paths(file_paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for file_path in file_paths {
        validate_git_relative_path(&file_path)?;
        if seen.insert(file_path.clone()) {
            paths.push(file_path);
        }
    }

    Ok(paths)
}

fn git_path_args(base_args: &[&str], file_paths: Vec<String>) -> Result<Vec<String>, String> {
    let paths = unique_git_file_paths(file_paths)?;
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut args: Vec<String> = base_args.iter().map(|arg| (*arg).to_string()).collect();
    args.push("--".to_string());
    args.extend(paths);
    Ok(args)
}

fn git_worktree_root(project_path: &str) -> Result<PathBuf, String> {
    let output = run_git(project_path, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let root = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if root.is_empty() {
        return Err("Cannot resolve git worktree root".to_string());
    }

    let root = PathBuf::from(root)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve git worktree root: {}", e))?;
    let project = Path::new(project_path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project path: {}", e))?;

    if !project.starts_with(&root) {
        return Err("Git worktree root does not contain project path".to_string());
    }

    Ok(root)
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|path| path.to_string())
        .ok_or_else(|| "Path contains invalid UTF-8".to_string())
}

fn git_has_head(worktree_root: &str) -> Result<bool, String> {
    let output = run_git(worktree_root, &["rev-parse", "--verify", "HEAD"])?;
    Ok(output.status.success())
}

const PROTECTED_FIRST_SEGMENTS: &[&str] = &[".git", ".nezha"];

fn is_protected_project_relative_path(relative_path: &str) -> bool {
    Path::new(relative_path)
        .components()
        .find_map(|component| match component {
            std::path::Component::Normal(name) => name.to_str().map(|name| {
                PROTECTED_FIRST_SEGMENTS
                    .iter()
                    .any(|protected| name.eq_ignore_ascii_case(protected))
            }),
            _ => None,
        })
        .unwrap_or(false)
}

fn apply_login_shell_env(cmd: &mut Command) {
    for (key, value) in get_login_shell_env() {
        cmd.env(key, value);
    }
}

fn run_agent_commit_message_command(
    agent: &str,
    project_path: &str,
    prompt: &str,
) -> Result<Output, String> {
    let launch = get_agent_launch_spec_helper(agent);
    let mut cmd = Command::new(&launch.program);
    configure_background_command(&mut cmd);
    if agent == "codex" {
        cmd.args(["exec", prompt]);
    } else {
        cmd.args(["-p", prompt, "--output-format", "text"]);
    }
    cmd.current_dir(project_path);
    cmd.stdin(Stdio::null());
    apply_login_shell_env(&mut cmd);
    for (key, value) in &launch.extra_env {
        cmd.env(key, value);
    }
    cmd.output()
        .map_err(|e| format!("Failed to run {agent}: {e}"))
}

fn create_empty_temp_file() -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("nezha-empty-{}.tmp", uuid::Uuid::new_v4()));
    std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create temporary file for git diff: {e}"))?;
    Ok(path)
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn generate_commit_message(project_path: String) -> Result<String, String> {
    // 1. Get staged diff
    let diff_output = run_git(&project_path, &["diff", "--staged"])?;
    let diff = String::from_utf8_lossy(&diff_output.stdout).into_owned();
    if diff.trim().is_empty() {
        return Err("No staged changes to generate a commit message for.".to_string());
    }

    // Truncate diff if too large to avoid CLI arg limits
    let diff = if diff.len() > 50_000 {
        format!("{}...(diff truncated)", &diff[..50_000])
    } else {
        diff
    };

    // 2. Read project config for prompt and default agent
    let config = read_project_config_helper(project_path.clone())?;
    let commit_prompt = config.git.commit_prompt;
    let timeout_secs = config.git.commit_message_timeout_secs.clamp(1, 120);
    let agent = config.agent.default;

    // 3. Build full prompt
    let full_prompt = format!(
        "{}\n\nGit diff:\n```diff\n{}\n```\n\nOutput only the commit message, nothing else.",
        commit_prompt, diff
    );

    // 4. Run agent in non-interactive exec mode with configurable timeout
    let output = tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        tokio::task::spawn_blocking(move || {
            run_agent_commit_message_command(&agent, &project_path, &full_prompt)
        }),
    )
    .await
    .map_err(|_| format!("Commit message generation timed out ({}s)", timeout_secs))?
    .map_err(|e| format!("Commit message thread error: {}", e))??;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!("Agent failed: {}{}", stderr, stdout));
    }

    let result = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if result.is_empty() {
        return Err("Agent returned empty response.".to_string());
    }
    Ok(result)
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct GitFileChange {
    path: String,
    status: String,
    staged: bool,
}

fn parse_porcelain_z_status(stdout: &[u8]) -> Vec<GitFileChange> {
    let mut changes = Vec::new();
    let mut entries = stdout
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty());

    while let Some(entry) = entries.next() {
        if entry.len() < 4 || entry[2] != b' ' {
            continue;
        }

        let x = entry[0] as char;
        let y = entry[1] as char;
        let display_path = String::from_utf8_lossy(&entry[3..]).into_owned();

        if x == 'R' || x == 'C' {
            let _ = entries.next();
        }

        if x == '?' && y == '?' {
            changes.push(GitFileChange {
                path: display_path,
                status: "?".to_string(),
                staged: false,
            });
        } else {
            if x != ' ' && x != '?' {
                changes.push(GitFileChange {
                    path: display_path.clone(),
                    status: x.to_string(),
                    staged: true,
                });
            }
            if y != ' ' && y != '?' {
                changes.push(GitFileChange {
                    path: display_path,
                    status: y.to_string(),
                    staged: false,
                });
            }
        }
    }

    changes
}

#[tauri::command]
pub async fn git_status(project_path: String) -> Result<Vec<GitFileChange>, String> {
    let args = vec![
        "-c".to_string(),
        "core.quotePath=false".to_string(),
        "status".to_string(),
        "--porcelain=v1".to_string(),
        "-z".to_string(),
        "--untracked-files=all".to_string(),
    ];

    let output = run_git_with_timeout(project_path, args, Duration::from_secs(5)).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let message = format!("{}{}", stderr, stdout).trim().to_string();

        return Err(if message.is_empty() {
            "Failed to get git status".to_string()
        } else {
            message
        });
    }

    Ok(parse_porcelain_z_status(&output.stdout))
}

#[derive(serde::Serialize, Clone)]
pub(crate) struct GitCommit {
    hash: String,
    short_hash: String,
    author: String,
    date: String,
    message: String,
    refs: Vec<String>,
}

#[derive(serde::Serialize)]
pub(crate) struct GitBranchInfo {
    name: String,
    current: bool,
    remote: Option<String>,
}

#[tauri::command]
pub async fn git_list_branches(project_path: String) -> Result<Vec<GitBranchInfo>, String> {
    let output = run_git_with_timeout(
        project_path,
        vec!["branch".to_string(), "-a".to_string()],
        Duration::from_secs(5),
    )
    .await?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut branches = Vec::new();
    for line in stdout.lines() {
        if line.len() < 2 {
            continue;
        }
        let current = line.starts_with("* ");
        let raw = line[2..].trim();
        // Skip HEAD pointer lines like "remotes/origin/HEAD -> origin/main"
        if raw.contains(" -> ") {
            continue;
        }
        if let Some(without_remotes) = raw.strip_prefix("remotes/") {
            // "origin/main" -> remote = "origin", name = "origin/main"
            let name = without_remotes.to_string();
            let remote = name.split('/').next().map(|s| s.to_string());
            branches.push(GitBranchInfo {
                name,
                current,
                remote,
            });
        } else if !raw.is_empty() {
            branches.push(GitBranchInfo {
                name: raw.to_string(),
                current,
                remote: None,
            });
        }
    }
    Ok(branches)
}

#[tauri::command]
pub async fn git_checkout_branch(
    project_path: String,
    branch_name: String,
    is_remote: bool,
) -> Result<(), String> {
    let args: Vec<String> = if is_remote {
        // "origin/main" -> local name "main", track remote
        let local_name = branch_name
            .split_once('/')
            .map(|(_, n)| n.to_string())
            .unwrap_or_else(|| branch_name.clone());
        vec![
            "checkout".into(),
            "-b".into(),
            local_name,
            "--track".into(),
            format!("remotes/{}", branch_name),
        ]
    } else {
        vec!["checkout".into(), branch_name.clone()]
    };
    run_git_check(&project_path, &args)
}

#[tauri::command]
pub async fn git_create_branch(
    project_path: String,
    branch_name: String,
    from_branch: String,
    checkout: bool,
) -> Result<(), String> {
    let args: &[&str] = if checkout {
        &["checkout", "-b", &branch_name, &from_branch]
    } else {
        &["branch", &branch_name, &from_branch]
    };
    run_git_check(&project_path, args)
}

#[tauri::command]
pub async fn git_log(
    project_path: String,
    limit: u32,
    search: Option<String>,
    branch: Option<String>,
) -> Result<Vec<GitCommit>, String> {
    let limit_str = limit.to_string();
    let format = "COMMIT:%H%nSHORT:%h%nAUTHOR:%an%nDATE:%ar%nSUBJECT:%s%nREFS:%D%nEND_RECORD";
    let mut args: Vec<String> = vec![
        "log".into(),
        format!("--format={}", format),
        "-n".into(),
        limit_str,
    ];
    if let Some(ref s) = search {
        if !s.is_empty() {
            args.push(format!("--grep={}", s));
        }
    }
    if let Some(ref b) = branch {
        if !b.is_empty() {
            args.push(b.clone());
        }
    }

    let output = run_git_with_timeout(project_path, args, Duration::from_secs(10)).await?;

    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let mut commits = Vec::new();
    let mut hash = String::new();
    let mut short_hash = String::new();
    let mut author = String::new();
    let mut date = String::new();
    let mut message = String::new();
    let mut refs: Vec<String> = Vec::new();

    for line in stdout.lines() {
        if let Some(v) = line.strip_prefix("COMMIT:") {
            hash = v.to_string();
        } else if let Some(v) = line.strip_prefix("SHORT:") {
            short_hash = v.to_string();
        } else if let Some(v) = line.strip_prefix("AUTHOR:") {
            author = v.to_string();
        } else if let Some(v) = line.strip_prefix("DATE:") {
            date = v.to_string();
        } else if let Some(v) = line.strip_prefix("SUBJECT:") {
            message = v.to_string();
        } else if let Some(v) = line.strip_prefix("REFS:") {
            refs = v.split(", ")
                .filter(|s| !s.is_empty())
                .map(|s| s.trim().to_string())
                .collect();
        } else if line == "END_RECORD" && !hash.is_empty() {
            commits.push(GitCommit {
                hash: hash.clone(),
                short_hash: short_hash.clone(),
                author: author.clone(),
                date: date.clone(),
                message: message.clone(),
                refs: refs.clone(),
            });
            hash.clear();
            short_hash.clear();
            author.clear();
            date.clear();
            message.clear();
            refs.clear();
        }
    }
    Ok(commits)
}

#[derive(serde::Serialize)]
pub(crate) struct GitCommitFile {
    path: String,
    status: String,
    additions: i32,
    deletions: i32,
}

#[derive(serde::Serialize)]
pub(crate) struct GitCommitDetail {
    hash: String,
    short_hash: String,
    author: String,
    date: String,
    message: String,
    files: Vec<GitCommitFile>,
    total_additions: i32,
    total_deletions: i32,
}

#[tauri::command]
pub async fn git_commit_detail(
    project_path: String,
    commit_hash: String,
) -> Result<GitCommitDetail, String> {
    let info_out = run_git(
        &project_path,
        &[
            "show",
            "--no-patch",
            "--format=HASH:%H%nSHORT:%h%nAUTHOR:%an%nDATE:%ar%nSUBJECT:%s",
            &commit_hash,
        ],
    )?;

    let info_str = String::from_utf8_lossy(&info_out.stdout).into_owned();
    let mut hash = String::new();
    let mut short_hash = String::new();
    let mut author = String::new();
    let mut date = String::new();
    let mut message = String::new();
    for line in info_str.lines() {
        if let Some(v) = line.strip_prefix("HASH:") {
            hash = v.to_string();
        } else if let Some(v) = line.strip_prefix("SHORT:") {
            short_hash = v.to_string();
        } else if let Some(v) = line.strip_prefix("AUTHOR:") {
            author = v.to_string();
        } else if let Some(v) = line.strip_prefix("DATE:") {
            date = v.to_string();
        } else if let Some(v) = line.strip_prefix("SUBJECT:") {
            message = v.to_string();
        }
    }

    let ns_out = run_git(
        &project_path,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--name-status",
            &commit_hash,
        ],
    )?;

    let mut file_statuses: HashMap<String, String> = HashMap::new();
    for line in String::from_utf8_lossy(&ns_out.stdout).lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        match parts.as_slice() {
            [st, path] => {
                file_statuses.insert(
                    path.to_string(),
                    if st.starts_with('R') {
                        "R".to_string()
                    } else {
                        st.to_string()
                    },
                );
            }
            [st, _old, new_path] => {
                file_statuses.insert(
                    new_path.to_string(),
                    if st.starts_with('R') {
                        "R".to_string()
                    } else {
                        st.to_string()
                    },
                );
            }
            _ => {}
        }
    }

    let num_out = run_git(
        &project_path,
        &[
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--numstat",
            &commit_hash,
        ],
    )?;

    let mut files = Vec::new();
    let mut total_additions = 0i32;
    let mut total_deletions = 0i32;

    for line in String::from_utf8_lossy(&num_out.stdout).lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() == 3 {
            let additions: i32 = parts[0].parse().unwrap_or(0);
            let deletions: i32 = parts[1].parse().unwrap_or(0);
            let path = parts[2].to_string();
            total_additions += additions;
            total_deletions += deletions;
            let status = file_statuses
                .get(&path)
                .cloned()
                .unwrap_or_else(|| "M".to_string());
            files.push(GitCommitFile {
                path,
                status,
                additions,
                deletions,
            });
        }
    }

    Ok(GitCommitDetail {
        hash,
        short_hash,
        author,
        date,
        message,
        files,
        total_additions,
        total_deletions,
    })
}

#[tauri::command]
pub async fn git_show_diff(project_path: String, commit_hash: String) -> Result<String, String> {
    let args = vec!["show".to_string(), "--format=".to_string(), commit_hash];
    let output = run_git_with_timeout(project_path, args, Duration::from_secs(10)).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let raw = output.stdout;
    let limit = 500 * 1024;
    Ok(String::from_utf8_lossy(if raw.len() > limit {
        &raw[..limit]
    } else {
        &raw
    })
    .into_owned())
}

#[tauri::command]
pub async fn git_file_diff(
    project_path: String,
    file_path: String,
    staged: bool,
) -> Result<String, String> {
    let mut args = vec!["diff".to_string()];
    if staged {
        args.push("--cached".to_string());
    }
    args.push("--".to_string());
    args.push(file_path.clone());

    let output = run_git_with_timeout(project_path.clone(), args, Duration::from_secs(10)).await?;
    let raw = output.stdout;

    // For untracked files, git diff returns nothing — fall back to --no-index diff
    if raw.is_empty() && !staged {
        let abs_path = std::path::Path::new(&project_path).join(&file_path);
        let abs_path_str = abs_path.to_string_lossy().into_owned();
        let empty_file = create_empty_temp_file()?;
        let fallback_args = vec![
            "diff".to_string(),
            "--no-index".to_string(),
            empty_file.to_string_lossy().into_owned(),
            abs_path_str,
        ];
        let fallback =
            run_git_with_timeout(project_path, fallback_args, Duration::from_secs(10)).await;
        let _ = std::fs::remove_file(&empty_file);
        let fallback = fallback?;
        let fallback_raw = fallback.stdout;
        let limit = 200 * 1024;
        return Ok(String::from_utf8_lossy(if fallback_raw.len() > limit {
            &fallback_raw[..limit]
        } else {
            &fallback_raw
        })
        .into_owned());
    }

    let limit = 200 * 1024;
    Ok(String::from_utf8_lossy(if raw.len() > limit {
        &raw[..limit]
    } else {
        &raw
    })
    .into_owned())
}

#[tauri::command]
pub async fn git_stage(project_path: String, file_path: String) -> Result<(), String> {
    run_git_check(&project_path, &["add", "--", &file_path])
}

#[tauri::command]
pub async fn git_unstage(project_path: String, file_path: String) -> Result<(), String> {
    if git_has_head(&project_path)? {
        run_git_check(&project_path, &["restore", "--staged", "--", &file_path])
    } else {
        // Before first commit, no HEAD — use `git reset` to unstage.
        run_git_check(&project_path, &["reset", "--", &file_path])
    }
}

#[tauri::command]
pub async fn git_stage_files(project_path: String, file_paths: Vec<String>) -> Result<(), String> {
    let args = git_path_args(&["add"], file_paths)?;
    if args.is_empty() {
        return Ok(());
    }

    let output = run_git_with_timeout(project_path, args, Duration::from_secs(10)).await?;
    if !output.status.success() {
        return Err(git_command_error(&output, "Failed to stage files"));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_unstage_files(
    project_path: String,
    file_paths: Vec<String>,
) -> Result<(), String> {
    // Before first commit, no HEAD — `git restore --staged` would fail, fall back to
    // HEAD-independent `git reset`. Use async run_git_with_timeout instead of sync git_has_head
    // to avoid blocking the Tokio runtime.
    let head_check = run_git_with_timeout(
        project_path.clone(),
        vec![
            "rev-parse".to_string(),
            "--verify".to_string(),
            "HEAD".to_string(),
        ],
        Duration::from_secs(5),
    )
    .await?;
    let base: &[&str] = if head_check.status.success() {
        &["restore", "--staged"]
    } else {
        &["reset"]
    };

    let args = git_path_args(base, file_paths)?;
    if args.is_empty() {
        return Ok(());
    }

    let output = run_git_with_timeout(project_path, args, Duration::from_secs(10)).await?;
    if !output.status.success() {
        return Err(git_command_error(&output, "Failed to unstage files"));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_stage_all(project_path: String) -> Result<(), String> {
    run_git_check(&project_path, &["add", "-A"])
}

#[tauri::command]
pub async fn git_unstage_all(project_path: String) -> Result<(), String> {
    run_git_check(&project_path, &["restore", "--staged", "."])
}

#[tauri::command]
pub async fn git_commit(project_path: String, message: String) -> Result<(), String> {
    run_git_check(&project_path, &["commit", "-m", &message])
}

fn untracked_files_under_directory<'a>(
    directory_path: &str,
    untracked_files: &'a [String],
) -> Vec<&'a str> {
    let directory = Path::new(directory_path);
    untracked_files
        .iter()
        .map(String::as_str)
        .filter(|path| {
            let path = Path::new(path);
            path != directory && path.starts_with(directory)
        })
        .collect()
}

fn is_listed_untracked_file(relative_path: &str, untracked_files: &[String]) -> bool {
    let relative_path = Path::new(relative_path);
    untracked_files
        .iter()
        .any(|path| Path::new(path) == relative_path)
}

fn is_protected_worktree_relative_path(
    worktree_root: &Path,
    project_path: &str,
    relative_path: &str,
) -> bool {
    if is_protected_project_relative_path(relative_path) {
        return true;
    }

    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return false;
    }

    let canonical_project = match Path::new(project_path).canonicalize() {
        Ok(path) => path,
        Err(_) => return false,
    };
    let target = worktree_root.join(rel);
    let Some(file_name) = target.file_name() else {
        return false;
    };
    let Some(parent) = target.parent() else {
        return false;
    };
    let Ok(canonical_parent) = parent.canonicalize() else {
        return false;
    };
    let resolved = canonical_parent.join(file_name);

    resolved
        .strip_prefix(&canonical_project)
        .ok()
        .map(|rel_from_project| {
            is_protected_project_relative_path(&rel_from_project.to_string_lossy())
        })
        .unwrap_or(false)
}

/// Move a worktree-relative path to the system trash. Canonicalize only the parent directory so
/// symlinks at the leaf are deleted as themselves rather than followed to their target. Reject
/// absolute or `..`-escaping relative paths defensively even though `git status` should never emit them.
fn trash_worktree_relative_path(
    worktree_root: &Path,
    project_path: &str,
    relative_path: &str,
) -> Result<(), String> {
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err("Untracked path must be relative".to_string());
    }

    let target = worktree_root.join(rel);
    let file_name = target
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();
    let parent = target
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory".to_string())?;

    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve parent directory: {}", e))?;
    let canonical_root = worktree_root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve git worktree root: {}", e))?;
    let canonical_project = Path::new(project_path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project path: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path is outside the git worktree".to_string());
    }

    let resolved = canonical_parent.join(&file_name);
    if resolved == canonical_root {
        return Err("Refusing to delete project root".to_string());
    }
    if resolved.symlink_metadata().is_err() {
        return Err("Path does not exist".to_string());
    }
    if is_protected_project_relative_path(relative_path) {
        return Err("Refusing to delete protected project metadata".to_string());
    }
    if let Ok(rel_from_project) = resolved.strip_prefix(&canonical_project) {
        let rel_from_project = rel_from_project.to_string_lossy();
        if is_protected_project_relative_path(&rel_from_project) {
            return Err("Refusing to delete protected project metadata".to_string());
        }
    }

    trash::delete(&resolved).map_err(|e| e.to_string())
}

fn discard_untracked_path(
    project_path: &str,
    worktree_root: &Path,
    relative_path: &str,
    untracked_files: &[String],
) -> Result<(), String> {
    let rel = Path::new(relative_path);
    if rel.is_absolute() {
        return Err("Untracked path must be relative".to_string());
    }
    if is_protected_worktree_relative_path(worktree_root, project_path, relative_path) {
        return Err("Refusing to delete protected project metadata".to_string());
    }

    let target = worktree_root.join(rel);
    let metadata = target
        .symlink_metadata()
        .map_err(|_| "Path does not exist".to_string())?;

    if metadata.file_type().is_dir() {
        for rel in untracked_files_under_directory(relative_path, untracked_files) {
            if is_protected_worktree_relative_path(worktree_root, project_path, rel) {
                continue;
            }
            trash_worktree_relative_path(worktree_root, project_path, rel)?;
        }
        return Ok(());
    }

    if !is_listed_untracked_file(relative_path, untracked_files) {
        return Err("Path is not an untracked file".to_string());
    }

    trash_worktree_relative_path(worktree_root, project_path, relative_path)
}

fn discard_untracked_file(
    project_path: &str,
    worktree_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let worktree_root = worktree_root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve git worktree root: {}", e))?;
    let worktree_root_string = path_to_string(&worktree_root)?;
    let untracked_files = list_untracked_files(&worktree_root_string)?;

    discard_untracked_path(
        project_path,
        &worktree_root,
        relative_path,
        &untracked_files,
    )
}

fn list_untracked_files(project_path: &str) -> Result<Vec<String>, String> {
    let output = run_git(
        project_path,
        &[
            "-c",
            "core.quotePath=false",
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
        ],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output
        .stdout
        .split(|b| *b == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect())
}

/// Discard a single file's pending changes.
///
/// - Untracked files: moved to the system trash.
/// - Tracked unstaged changes: `git restore -- <file>` resets the worktree to the index, leaving
///   any staged half intact (so MM files don't lose their staged portion).
///
/// We deliberately don't expose a "discard staged" path here — staged-only files have no per-row
/// discard button in the UI (matching VSCode), and "Discard All" handles the staged side via
/// `git_discard_all` which correctly undoes renames too.
#[tauri::command]
pub async fn git_discard_file(
    project_path: String,
    file_path: String,
    untracked: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        validate_project_path(&project_path)?;
        let worktree_root = git_worktree_root(&project_path)?;
        let worktree_root_string = path_to_string(&worktree_root)?;
        if untracked {
            discard_untracked_file(&project_path, &worktree_root, &file_path)
        } else {
            run_git_check(&worktree_root_string, &["restore", "--", &file_path])
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard_files(
    project_path: String,
    file_paths: Vec<String>,
    untracked: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        validate_project_path(&project_path)?;
        let file_paths = unique_git_file_paths(file_paths)?;
        if file_paths.is_empty() {
            return Ok(());
        }

        let worktree_root = git_worktree_root(&project_path)?;
        let worktree_root_string = path_to_string(&worktree_root)?;
        if untracked {
            let untracked_files = list_untracked_files(&worktree_root_string)?;
            for file_path in file_paths {
                discard_untracked_path(
                    &project_path,
                    &worktree_root,
                    &file_path,
                    &untracked_files,
                )?;
            }
            return Ok(());
        }

        let mut args = vec!["restore".to_string(), "--".to_string()];
        args.extend(file_paths);
        run_git_check(&worktree_root_string, &args)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_discard_all(project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        validate_project_path(&project_path)?;
        let worktree_root = git_worktree_root(&project_path)?;
        let worktree_root_string = path_to_string(&worktree_root)?;
        // Reset every tracked file (staged + worktree) back to HEAD.
        // Staged-only adds become untracked after this; they are cleaned in the second pass.
        if git_has_head(&worktree_root_string)? {
            run_git_check(
                &worktree_root_string,
                &["restore", "--source=HEAD", "--staged", "--worktree", "."],
            )?;
        } else {
            run_git_check(
                &worktree_root_string,
                &["rm", "-r", "--cached", "--ignore-unmatch", "--", "."],
            )?;
        }

        for rel in list_untracked_files(&worktree_root_string)? {
            if is_protected_worktree_relative_path(&worktree_root, &project_path, &rel) {
                continue;
            }
            trash_worktree_relative_path(&worktree_root, &project_path, &rel)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_show_file_diff(
    project_path: String,
    commit_hash: String,
    file_path: String,
) -> Result<String, String> {
    let output = run_git(
        &project_path,
        &["show", "--format=", &commit_hash, "--", &file_path],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let raw = output.stdout;
    let limit = 500 * 1024;
    Ok(String::from_utf8_lossy(if raw.len() > limit {
        &raw[..limit]
    } else {
        &raw
    })
    .into_owned())
}

#[tauri::command]
pub async fn git_push(project_path: String, branch: Option<String>) -> Result<String, String> {
    let mut args = vec!["push".to_string()];
    if let Some(ref b) = branch.filter(|s| !s.is_empty()) {
        args.push("origin".to_string());
        args.push(b.clone());
    }
    let output = run_git(&project_path, &args)?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(combined);
    }
    Ok(combined.trim().to_string())
}

#[tauri::command]
pub async fn git_pull(project_path: String) -> Result<String, String> {
    let output = run_git(&project_path, &["pull"])?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        return Err(combined);
    }
    Ok(combined.trim().to_string())
}

#[derive(serde::Serialize)]
pub(crate) struct GitRemoteCounts {
    ahead: i32,
    behind: i32,
    branch: String,
}

#[tauri::command]
pub async fn git_remote_counts(
    project_path: String,
    branch: Option<String>,
) -> Result<GitRemoteCounts, String> {
    let branch = if let Some(b) = branch.filter(|s| !s.is_empty()) {
        b
    } else {
        let branch_out = run_git(&project_path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
        String::from_utf8_lossy(&branch_out.stdout)
            .trim()
            .to_string()
    };

    let rev_str = format!("{}...@{{u}}", branch);
    let rev_out = run_git(
        &project_path,
        &["rev-list", "--count", "--left-right", &rev_str],
    );

    let (ahead, behind) = match rev_out {
        Ok(o) if o.status.success() => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            let parts: Vec<&str> = s.split_whitespace().collect();
            if parts.len() == 2 {
                (parts[0].parse().unwrap_or(0), parts[1].parse().unwrap_or(0))
            } else {
                (0, 0)
            }
        }
        _ => (0, 0),
    };

    Ok(GitRemoteCounts {
        ahead,
        behind,
        branch,
    })
}
