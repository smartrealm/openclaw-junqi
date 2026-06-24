// ── Workspace path accessor ──────────────────────────────────────────────────
//
// Exposes the agent's runtime workspace directory (`~/.openclaw/workspace` by
// default, or the user-configured `agents.defaults.workspace` from
// openclaw.json) so the frontend can scope per-workspace queries (file
// mention, project files list, etc.) without re-implementing the config
// resolution logic.
//
// Reuses `paths::read_workspace_from_config` + `paths::default_workspace_dir`.

use crate::paths;

#[tauri::command]
pub fn get_workspace_path() -> Result<String, String> {
    let config_path = paths::config_path();
    let workspace = paths::read_workspace_from_config(&config_path)
        .unwrap_or_else(paths::default_workspace_dir);
    if !workspace.exists() {
        // Don't fail — the frontend might be checking before first launch.
        // Just return the path so it can show "workspace not initialized".
    }
    Ok(workspace.to_string_lossy().into_owned())
}