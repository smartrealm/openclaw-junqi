use crate::commands::{setup, system};
use crate::paths;
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeStatus {
    runtime_dir: String,
    node: system::NodeStatus,
    node_requirement: String,
    node_requirement_source: String,
    node_auto_update_supported: bool,
    git: system::GitStatus,
    git_auto_update_supported: bool,
    node_download_order: Vec<String>,
    git_download_order: Vec<String>,
}

#[tauri::command]
pub async fn get_managed_runtime_status() -> Result<ManagedRuntimeStatus, String> {
    let requirement = system::installed_openclaw_node_requirement()?;
    let (node, git) = tokio::join!(
        system::check_node_for_requirement(&requirement),
        system::check_git(),
    );
    Ok(ManagedRuntimeStatus {
        // Kept in the response for compatibility with older frontends. New
        // installations use operating-system locations for Node.js and Git.
        runtime_dir: String::new(),
        node: node?,
        node_requirement: requirement.expression().to_string(),
        node_requirement_source: requirement.source().id().to_string(),
        node_auto_update_supported: cfg!(windows),
        git: git?,
        git_auto_update_supported: cfg!(windows),
        node_download_order: if paths::configured_node_runtime_dir().is_some() {
            vec!["npmmirror.com".into(), "nodejs.org".into()]
        } else if cfg!(windows) {
            vec![
                "Windows Package Manager".into(),
                "OpenJS.NodeJS.LTS / OpenJS.NodeJS".into(),
            ]
        } else {
            Vec::new()
        },
        git_download_order: if paths::configured_git_runtime_dir().is_some() {
            vec!["npmmirror.com".into(), "GitHub".into()]
        } else if cfg!(windows) {
            vec!["Windows Package Manager".into(), "Git.Git".into()]
        } else {
            Vec::new()
        },
    })
}

#[tauri::command]
pub async fn update_managed_node(app: tauri::AppHandle) -> Result<String, String> {
    setup::update_managed_node_runtime(app).await
}

#[tauri::command]
pub async fn update_managed_git(app: tauri::AppHandle) -> Result<String, String> {
    setup::update_managed_git_runtime(app).await
}
