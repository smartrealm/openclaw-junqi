// ── Workspace path accessor ──────────────────────────────────────────────────
//
// Exposes the agent's runtime workspace directory (the configured storage
// default or `agents.defaults.workspace` from openclaw.json) so the frontend
// can scope per-workspace queries without re-implementing config resolution.
//
// Reuses `paths::read_workspace_from_config` + `paths::default_workspace_dir`.

use crate::paths;

#[tauri::command]
pub fn get_workspace_path() -> Result<String, String> {
    let config_path = paths::active_config_path();
    let workspace = paths::read_workspace_from_config(&config_path)
        .unwrap_or_else(paths::default_workspace_dir);
    if !workspace.exists() {
        // Don't fail — the frontend might be checking before first launch.
        // Just return the path so it can show "workspace not initialized".
    }
    Ok(workspace.to_string_lossy().into_owned())
}
