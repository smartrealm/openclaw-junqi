//! Project-directory lifecycle for the embedded terminal.
//!
//! A terminal workspace is allowed to point only at a directory that exists
//! right now.  Keeping resolution, recent-folder persistence, and shell `cd`
//! generation on the same canonical path prevents stale aliases from creating
//! workspaces that cannot launch.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const RECENT_WORKSPACES_FILE: &str = "terminal-recent-workspaces.json";
const RECENT_WORKSPACES_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceDirectory {
    pub path: String,
    pub name: String,
}

/// The only worktree shape exposed to the terminal UI. The backend resolves
/// both paths after Git succeeds, so a sidebar child never points at a stale
/// relative path or a caller-provided alias.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceWorktree {
    pub path: String,
    pub branch: String,
    pub name: String,
}

fn recent_workspaces_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Resolve a directory once for every terminal-facing path.  Callers receive
/// a canonical path, so symlink aliases cannot create duplicate workspaces or
/// make a shell start in a different directory than the sidebar displays.
pub fn resolve_terminal_workspace_directory(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let candidate = path.as_ref();
    if candidate.as_os_str().is_empty() {
        return Err("terminal workspace directory is empty".to_string());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|_| "terminal workspace directory does not exist".to_string())?;
    if !canonical.is_dir() {
        return Err("terminal workspace path is not a directory".to_string());
    }
    Ok(canonical)
}

fn application_home_directory() -> Option<PathBuf> {
    crate::platform::home_dir().map(|path| path.canonicalize().unwrap_or(path))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn directory_record(path: PathBuf) -> TerminalWorkspaceDirectory {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_string(&path));
    TerminalWorkspaceDirectory {
        path: path_string(&path),
        name,
    }
}

fn configure_background_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn run_terminal_git(repo: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    let mut command = Command::new(crate::platform::resolve_spawn_program("git"));
    configure_background_command(&mut command);
    command.current_dir(repo);
    for (key, value) in crate::platform::login_shell_env() {
        command.env(key, value);
    }
    command
        .args(args)
        .output()
        .map_err(|error| format!("run git: {error}"))
}

fn git_stdout(repo: &Path, args: &[&str]) -> Result<String, String> {
    let output = run_terminal_git(repo, args)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if error.is_empty() {
        "git command failed".to_string()
    } else {
        error
    })
}

fn terminal_worktree_repo_root(project_path: &str) -> Result<PathBuf, String> {
    let project = resolve_terminal_workspace_directory(project_path)?;
    let root = git_stdout(&project, &["rev-parse", "--show-toplevel"])?;
    resolve_terminal_workspace_directory(root)
}

fn terminal_local_branch_exists(repo_root: &Path, branch: &str) -> Result<bool, String> {
    let reference = format!("refs/heads/{branch}");
    let output = run_terminal_git(
        repo_root,
        &["show-ref", "--verify", "--quiet", reference.as_str()],
    )?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if error.is_empty() {
                "could not inspect local worktree branch".to_string()
            } else {
                error
            })
        }
    }
}

fn validate_terminal_worktree_branch(value: &str) -> Result<String, String> {
    let branch = value.trim();
    if branch.is_empty()
        || branch.starts_with('-')
        || branch.ends_with('/')
        || branch.ends_with('.')
    {
        return Err("invalid worktree branch name".to_string());
    }
    if branch.contains("..") || branch.contains("@{") || branch.contains("//") {
        return Err("invalid worktree branch name".to_string());
    }
    if !branch.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '/' | '-' | '_' | '.')
    }) {
        return Err("invalid worktree branch name".to_string());
    }
    Ok(branch.to_string())
}

fn default_terminal_worktree_path(repo_root: &Path, branch: &str) -> Result<PathBuf, String> {
    let parent = repo_root
        .parent()
        .ok_or_else(|| "repository has no parent directory".to_string())?;
    let repository_name = repo_root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "repository has no directory name".to_string())?;
    let suffix = branch.replace('/', "-");
    Ok(parent.join(format!("{repository_name}-{suffix}")))
}

fn listed_terminal_worktrees(repo_root: &Path) -> Result<Vec<PathBuf>, String> {
    let raw = git_stdout(repo_root, &["worktree", "list", "--porcelain"])?;
    raw.lines()
        .filter_map(|line| line.strip_prefix("worktree "))
        .map(resolve_terminal_workspace_directory)
        .collect()
}

fn terminal_worktree_belongs_to_repo(repo_root: &Path, target: &Path) -> Result<bool, String> {
    let target = resolve_terminal_workspace_directory(target)?;
    Ok(listed_terminal_worktrees(repo_root)?
        .iter()
        .any(|candidate| same_path(candidate, &target)))
}

fn recent_workspaces_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(RECENT_WORKSPACES_FILE))
        .map_err(|error| format!("resolve terminal recent workspaces path: {error}"))
}

/// Corrupt or incomplete recent-folder state must never stop a terminal from
/// opening.  Treat it as an empty history and let the next successful record
/// repair the file.
fn read_recent_paths(path: &Path) -> Result<Vec<String>, String> {
    match fs::read(path) {
        Ok(contents) => Ok(serde_json::from_slice::<Vec<String>>(&contents)
            .unwrap_or_default()
            .into_iter()
            .filter(|value| !value.is_empty())
            .take(RECENT_WORKSPACES_LIMIT)
            .collect()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("read terminal recent workspaces: {error}")),
    }
}

fn write_recent_paths(path: &Path, paths: &[String]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid terminal recent workspaces path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create terminal recent workspaces directory: {error}"))?;

    let contents = serde_json::to_vec(paths)
        .map_err(|error| format!("encode terminal recent workspaces: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(RECENT_WORKSPACES_FILE);
    let temporary = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    if let Err(error) = fs::write(&temporary, contents) {
        return Err(format!("write terminal recent workspaces: {error}"));
    }
    if let Err(error) = replace_written_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("save terminal recent workspaces: {error}"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_written_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_written_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    replace_written_file_with_backup(temporary, destination)
}

/// Windows cannot reliably rename a file over an existing destination. Move
/// the previous history aside first and restore it if installing the new file
/// fails. The caller holds `recent_workspaces_lock` for the whole operation.
#[cfg(any(windows, test))]
fn replace_written_file_with_backup(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination);
    }

    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "replacement destination has no parent",
        )
    })?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(RECENT_WORKSPACES_FILE);
    let backup = parent.join(format!(".{file_name}.{}.backup", uuid::Uuid::new_v4()));

    fs::rename(destination, &backup)?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(replace_error) => match fs::rename(&backup, destination) {
            Ok(()) => Err(replace_error),
            Err(rollback_error) => Err(std::io::Error::new(
                replace_error.kind(),
                format!(
                    "{replace_error}; restoring previous history from {} failed: {rollback_error}",
                    backup.display()
                ),
            )),
        },
    }
}

fn normalized_path_text(path: &str, windows: bool) -> String {
    let mut normalized = path.to_string();
    if windows {
        normalized = normalized.replace('\\', "/");
        if normalized
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/UNC/"))
        {
            normalized = format!("//{}", normalized.get(8..).unwrap_or_default());
        } else if normalized
            .get(..4)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("//?/"))
        {
            normalized = normalized.get(4..).unwrap_or_default().to_string();
        }
    }

    let minimum_length = if normalized.starts_with("//") {
        2
    } else if normalized.starts_with('/') {
        1
    } else if windows
        && normalized.len() >= 3
        && normalized.as_bytes()[1] == b':'
        && normalized.as_bytes()[2] == b'/'
    {
        3
    } else {
        0
    };
    while normalized.len() > minimum_length && normalized.ends_with('/') {
        normalized.pop();
    }

    if windows {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn path_comparison_key(path: &Path) -> String {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    normalized_path_text(&path_string(&normalized), cfg!(windows))
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_comparison_key(left) == path_comparison_key(right)
}

fn normalize_recent_paths(paths: Vec<String>, home: Option<&Path>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| {
            let candidate = Path::new(path);
            home.map(|home| !same_path(candidate, home)).unwrap_or(true)
        })
        .filter(|path| seen.insert(path_comparison_key(Path::new(path))))
        .take(RECENT_WORKSPACES_LIMIT)
        .collect()
}

fn record_recent_path(paths: Vec<String>, directory: &Path, home: Option<&Path>) -> Vec<String> {
    let directory = path_string(directory);
    let mut next = normalize_recent_paths(paths, home)
        .into_iter()
        .filter(|path| !same_path(Path::new(path), Path::new(&directory)))
        .collect::<Vec<_>>();

    let is_home = home
        .map(|home| same_path(Path::new(&directory), home))
        .unwrap_or(false);
    if !is_home {
        next.insert(0, directory);
    }
    next.truncate(RECENT_WORKSPACES_LIMIT);
    next
}

fn remove_recent_path(paths: Vec<String>, target: &str, windows: bool) -> Vec<String> {
    let target_key = normalized_path_text(target, windows);
    paths
        .into_iter()
        .filter(|path| normalized_path_text(path, windows) != target_key)
        .collect()
}

fn visible_recent_directories(
    paths: Vec<String>,
    home: Option<&Path>,
) -> Vec<TerminalWorkspaceDirectory> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| resolve_terminal_workspace_directory(path).ok())
        .filter(|path| home.map(|home| !same_path(path, home)).unwrap_or(true))
        .filter(|path| seen.insert(path.clone()))
        .map(directory_record)
        .take(RECENT_WORKSPACES_LIMIT)
        .collect()
}

fn record_workspace_directory(app: &AppHandle, directory: &Path) -> Result<(), String> {
    let storage_path = recent_workspaces_path(app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    let current = read_recent_paths(&storage_path)?;
    let next = record_recent_path(
        current.clone(),
        directory,
        application_home_directory().as_deref(),
    );
    if next != current {
        write_recent_paths(&storage_path, &next)?;
    }
    Ok(())
}

/// Validate and remember a directory selected by the user before it becomes a
/// workspace root.  The UI can safely create a terminal with the returned path.
#[tauri::command]
pub fn open_terminal_workspace_directory(
    app: AppHandle,
    path: String,
) -> Result<TerminalWorkspaceDirectory, String> {
    let directory = resolve_terminal_workspace_directory(path)?;
    record_workspace_directory(&app, &directory)?;
    Ok(directory_record(directory))
}

/// Create a sibling worktree the same way Kooky creates a project child. The
/// user-facing branch name is validated before Git sees it, but every value is
/// still supplied as an individual process argument rather than shell text.
#[tauri::command]
pub async fn create_terminal_workspace_worktree(
    project_path: String,
    branch: String,
    start_point: Option<String>,
) -> Result<TerminalWorkspaceWorktree, String> {
    tokio::task::spawn_blocking(move || {
        let repo_root = terminal_worktree_repo_root(&project_path)?;
        let branch = validate_terminal_worktree_branch(&branch)?;
        let worktree_path = default_terminal_worktree_path(&repo_root, &branch)?;
        if worktree_path.exists() {
            return Err(format!(
                "worktree path already exists: {}",
                worktree_path.display()
            ));
        }

        let worktree_path_text = path_string(&worktree_path);
        let start = start_point
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("HEAD");
        if terminal_local_branch_exists(&repo_root, &branch)? {
            // An existing branch must be attached as-is. `git worktree add -b`
            // would incorrectly fail or imply that the branch can be recreated.
            git_stdout(
                &repo_root,
                &["worktree", "add", &worktree_path_text, &branch],
            )?;
        } else {
            git_stdout(
                &repo_root,
                &["worktree", "add", "-b", &branch, &worktree_path_text, start],
            )?;
        }

        let path = resolve_terminal_workspace_directory(&worktree_path)?;
        if !terminal_worktree_belongs_to_repo(&repo_root, &path)? {
            return Err("created path is not registered as a repository worktree".to_string());
        }
        Ok(TerminalWorkspaceWorktree {
            path: path_string(&path),
            branch: branch.clone(),
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or(branch),
        })
    })
    .await
    .map_err(|error| format!("create worktree task failed: {error}"))?
}

/// Discover every sibling worktree Git currently knows about. This is read
/// only: the terminal sidebar uses it for explicit adoption and to discard
/// persisted child rows whose directories disappeared. Discovery alone never
/// changes the user's sidebar membership.
#[tauri::command]
pub async fn list_terminal_workspace_worktrees(
    project_path: String,
) -> Result<Vec<TerminalWorkspaceWorktree>, String> {
    tokio::task::spawn_blocking(move || {
        let repo_root = terminal_worktree_repo_root(&project_path)?;
        listed_terminal_worktrees(&repo_root)?
            .into_iter()
            .filter(|path| !same_path(path, &repo_root))
            .map(|path| {
                let branch = git_stdout(&path, &["branch", "--show-current"])
                    .ok()
                    .filter(|branch| !branch.is_empty())
                    .unwrap_or_else(|| "detached".to_string());
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| branch.clone());
                Ok(TerminalWorkspaceWorktree {
                    path: path_string(&path),
                    branch,
                    name,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| format!("list worktree task failed: {error}"))?
}

/// Remove a worktree only after it has been rediscovered through the source
/// repository. This prevents a stale sidebar record from deleting an arbitrary
/// directory. The branch delete is deliberately best-effort: the worktree is
/// already gone if the branch was merged or removed elsewhere.
#[tauri::command]
pub async fn remove_terminal_workspace_worktree(
    project_path: String,
    worktree_path: String,
    branch: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let repo_root = terminal_worktree_repo_root(&project_path)?;
        let target = resolve_terminal_workspace_directory(&worktree_path)?;
        if !terminal_worktree_belongs_to_repo(&repo_root, &target)? {
            return Err("worktree is not registered under this repository".to_string());
        }
        // A worktree created outside JunQi may use a branch name that our
        // create dialog deliberately rejects. The worktree removal itself is
        // still safe after repository membership has been verified; skip only
        // the optional branch delete for such names.
        let branch = validate_terminal_worktree_branch(&branch).ok();
        let target_text = path_string(&target);
        git_stdout(&repo_root, &["worktree", "remove", "--force", &target_text])?;

        if let Some(branch) = branch {
            let _ = git_stdout(&repo_root, &["branch", "-D", &branch]);
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("remove worktree task failed: {error}"))?
}

/// Record an existing workspace root after a regular "New Workspace" action.
/// Failure to persist history does not affect the already-open terminal.
#[tauri::command]
pub fn record_terminal_workspace_directory(app: AppHandle, path: String) -> Result<(), String> {
    let directory = resolve_terminal_workspace_directory(path)?;
    record_workspace_directory(&app, &directory)
}

/// Return only directories still present on disk.  Missing mounted volumes are
/// display-filtered rather than erased so they reappear when mounted again.
#[tauri::command]
pub fn list_terminal_recent_workspaces(
    app: AppHandle,
) -> Result<Vec<TerminalWorkspaceDirectory>, String> {
    let storage_path = recent_workspaces_path(&app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    let paths = read_recent_paths(&storage_path)?;
    Ok(visible_recent_directories(
        paths,
        application_home_directory().as_deref(),
    ))
}

/// Remove one workspace from history without requiring it to still exist on
/// disk. This also lets users remove entries for unavailable Windows drives or
/// disconnected network shares.
#[tauri::command]
pub fn remove_terminal_recent_workspace(app: AppHandle, path: String) -> Result<(), String> {
    if path.is_empty() {
        return Err("terminal workspace directory is empty".to_string());
    }
    let requested = Path::new(&path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path));
    let requested = path_string(&requested);

    let storage_path = recent_workspaces_path(&app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    let current = read_recent_paths(&storage_path)?;
    let next = remove_recent_path(current.clone(), &requested, cfg!(windows));
    if next != current {
        write_recent_paths(&storage_path, &next)?;
    }
    Ok(())
}

#[tauri::command]
pub fn clear_terminal_recent_workspaces(app: AppHandle) -> Result<(), String> {
    let storage_path = recent_workspaces_path(&app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    write_recent_paths(&storage_path, &[])
}

#[cfg(test)]
mod tests {
    use super::{
        default_terminal_worktree_path, normalize_recent_paths, normalized_path_text,
        read_recent_paths, record_recent_path, remove_recent_path,
        replace_written_file_with_backup, resolve_terminal_workspace_directory,
        validate_terminal_worktree_branch, visible_recent_directories, write_recent_paths,
    };
    use std::fs;
    use std::path::Path;

    fn scratch_directory(label: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("junqi-terminal-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn recent_paths_are_lru_deduplicated_and_exclude_home() {
        let home = scratch_directory("home");
        let alpha = scratch_directory("alpha");
        let beta = scratch_directory("beta");
        let alpha_path = alpha.to_string_lossy().into_owned();
        let beta_path = beta.to_string_lossy().into_owned();

        let with_alpha = record_recent_path(Vec::new(), &alpha, Some(&home));
        let with_beta = record_recent_path(with_alpha, &beta, Some(&home));
        let reopened_alpha = record_recent_path(with_beta, &alpha, Some(&home));
        let ignored_home = record_recent_path(reopened_alpha, &home, Some(&home));

        assert_eq!(ignored_home, vec![alpha_path, beta_path]);
        let _ = fs::remove_dir_all(home);
        let _ = fs::remove_dir_all(alpha);
        let _ = fs::remove_dir_all(beta);
    }

    #[test]
    fn recent_entries_filter_missing_directories_without_erasing_them() {
        let home = scratch_directory("home");
        let existing = scratch_directory("existing");
        let missing = scratch_directory("missing");
        fs::remove_dir_all(&missing).unwrap();

        let visible = visible_recent_directories(
            vec![
                missing.to_string_lossy().into_owned(),
                existing.to_string_lossy().into_owned(),
                home.to_string_lossy().into_owned(),
            ],
            Some(&home),
        );

        assert_eq!(visible.len(), 1);
        assert_eq!(
            visible[0].path,
            existing.canonicalize().unwrap().to_string_lossy()
        );
        let _ = fs::remove_dir_all(home);
        let _ = fs::remove_dir_all(existing);
    }

    #[test]
    fn resolver_rejects_missing_and_non_directory_paths() {
        let missing =
            std::env::temp_dir().join(format!("junqi-terminal-missing-{}", uuid::Uuid::new_v4()));
        assert!(resolve_terminal_workspace_directory(&missing).is_err());

        let parent = scratch_directory("file-parent");
        let file = parent.join("not-a-directory");
        fs::write(&file, "x").unwrap();
        assert!(resolve_terminal_workspace_directory(&file).is_err());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn normalization_preserves_order_and_removes_duplicates() {
        let normalized = normalize_recent_paths(
            vec!["/a".to_string(), "/b".to_string(), "/a".to_string()],
            Some(Path::new("/home/example")),
        );
        assert_eq!(normalized, vec!["/a", "/b"]);
    }

    #[test]
    fn normalization_preserves_legal_path_whitespace() {
        assert_ne!(
            normalized_path_text("/projects/report ", false),
            normalized_path_text("/projects/report", false)
        );
        assert_ne!(
            normalized_path_text(r"\\?\C:\Projects\Report ", true),
            normalized_path_text(r"C:\Projects\Report", true)
        );
    }

    #[test]
    fn removal_preserves_the_order_of_every_other_entry() {
        let paths = vec![
            "/alpha".to_string(),
            "/beta".to_string(),
            "/gamma".to_string(),
        ];

        assert_eq!(
            remove_recent_path(paths, "/beta/", false),
            vec!["/alpha", "/gamma"]
        );
    }

    #[test]
    fn windows_path_normalization_handles_verbatim_unc_case_and_separators() {
        assert_eq!(
            normalized_path_text(r"\\?\C:\Users\Wei\Project\", true),
            normalized_path_text("c:/users/wei/project", true)
        );
        assert_eq!(
            normalized_path_text(r"\\?\UNC\Server\Share\Project", true),
            normalized_path_text(r"//server/share/project/", true)
        );
        assert_ne!(
            normalized_path_text("/Projects/App", false),
            normalized_path_text("/projects/app", false)
        );
    }

    #[test]
    fn windows_style_removal_matches_equivalent_path_spelling() {
        let paths = vec![
            r"D:\Projects\Alpha".to_string(),
            r"\\Server\Share\Beta".to_string(),
            r"D:\Projects\Gamma".to_string(),
        ];

        assert_eq!(
            remove_recent_path(paths, "//server/share/beta/", true),
            vec![r"D:\Projects\Alpha", r"D:\Projects\Gamma"]
        );
    }

    #[test]
    fn recent_history_recovers_from_corruption_and_replaces_previous_contents() {
        let root = scratch_directory("history");
        let history = root.join("recent.json");
        let initial = vec!["/first".to_string(), "/second".to_string()];
        let replacement = vec!["/replacement".to_string()];

        write_recent_paths(&history, &initial).unwrap();
        assert_eq!(read_recent_paths(&history).unwrap(), initial);
        write_recent_paths(&history, &replacement).unwrap();
        assert_eq!(read_recent_paths(&history).unwrap(), replacement);

        fs::write(&history, "not valid json").unwrap();
        assert!(read_recent_paths(&history).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn recent_history_round_trip_preserves_path_whitespace() {
        let root = scratch_directory("history-whitespace");
        let history = root.join("recent.json");
        let paths = vec![
            "/projects/report ".to_string(),
            " /projects/report".to_string(),
        ];

        write_recent_paths(&history, &paths).unwrap();

        assert_eq!(read_recent_paths(&history).unwrap(), paths);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_replacement_overwrites_an_existing_history_file() {
        let root = scratch_directory("replace-existing");
        let destination = root.join("recent.json");
        let temporary = root.join("recent.json.tmp");
        fs::write(&destination, "old").unwrap();
        fs::write(&temporary, "new").unwrap();

        replace_written_file_with_backup(&temporary, &destination).unwrap();

        assert_eq!(fs::read_to_string(&destination).unwrap(), "new");
        assert!(!temporary.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backup_replacement_restores_history_when_installing_new_file_fails() {
        let root = scratch_directory("replace-rollback");
        let destination = root.join("recent.json");
        let missing_temporary = root.join("missing.tmp");
        fs::write(&destination, "old").unwrap();

        assert!(replace_written_file_with_backup(&missing_temporary, &destination).is_err());

        assert_eq!(fs::read_to_string(&destination).unwrap(), "old");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn worktree_branch_validation_rejects_git_revision_syntax_and_shell_like_input() {
        assert_eq!(
            validate_terminal_worktree_branch("feature/terminal-parity").unwrap(),
            "feature/terminal-parity"
        );
        for invalid in [
            "",
            "-danger",
            "feature//nested",
            "feature..old",
            "x@{1}",
            "x;rm",
        ] {
            assert!(
                validate_terminal_worktree_branch(invalid).is_err(),
                "{invalid} should fail"
            );
        }
    }

    #[test]
    fn default_worktree_path_is_a_stable_sibling_of_the_repository() {
        let path =
            default_terminal_worktree_path(Path::new("/projects/junqi"), "feature/ui").unwrap();
        assert_eq!(path, Path::new("/projects/junqi-feature-ui"));
    }
}
