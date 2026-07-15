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
    git: system::GitStatus,
    git_managed_by_junqi: bool,
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
        runtime_dir: paths::runtime_dir().to_string_lossy().into_owned(),
        node: node?,
        node_requirement: requirement.expression().to_string(),
        node_requirement_source: requirement.source().id().to_string(),
        git: git?,
        git_managed_by_junqi: cfg!(windows),
        node_download_order: vec!["npmmirror.com".into(), "nodejs.org".into()],
        git_download_order: if cfg!(windows) {
            vec!["npmmirror.com".into(), "github.com".into()]
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
