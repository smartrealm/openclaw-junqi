use crate::commands::{git_runtime, node_runtime, setup, system};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedRuntimeStatus {
    node: system::NodeStatus,
    node_requirement: String,
    node_requirement_source: String,
    node_auto_update_supported: bool,
    git: system::GitStatus,
    git_auto_update_supported: bool,
    node_download_order: Vec<String>,
    git_download_order: Vec<String>,
}

fn runtime_update_supported(
    portable_update_supported: bool,
    system_update_supported: bool,
    source: Option<system::RuntimeToolSource>,
) -> bool {
    match source {
        Some(system::RuntimeToolSource::Custom) => portable_update_supported,
        Some(system::RuntimeToolSource::System) | None => system_update_supported,
    }
}

#[tauri::command]
pub async fn get_managed_runtime_status() -> Result<ManagedRuntimeStatus, String> {
    let requirement = system::installed_openclaw_node_requirement()?;
    let (node, git) = tokio::join!(
        system::check_node_for_requirement(&requirement),
        system::check_git(),
    );
    let node = node?;
    let git = git?;
    let capabilities = crate::commands::runtime_policy::ManagedRuntimeCapabilities::current();
    let node_auto_update_supported = runtime_update_supported(
        capabilities.node,
        capabilities.system_node_update,
        node.source,
    );
    let git_auto_update_supported =
        runtime_update_supported(capabilities.git, capabilities.system_git_update, git.source);
    let node_uses_custom_runtime = node.source == Some(system::RuntimeToolSource::Custom);
    let git_uses_custom_runtime = git.source == Some(system::RuntimeToolSource::Custom);
    Ok(ManagedRuntimeStatus {
        node,
        node_requirement: requirement.expression().to_string(),
        node_requirement_source: requirement.source().id().to_string(),
        node_auto_update_supported,
        git,
        git_auto_update_supported,
        node_download_order: if node_uses_custom_runtime && capabilities.node {
            node_runtime::node_download_order()
        } else {
            Vec::new()
        },
        git_download_order: if git_uses_custom_runtime && capabilities.git {
            git_runtime::managed_git_download_order()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_and_custom_runtime_updates_follow_the_platform_policy() {
        assert!(runtime_update_supported(
            true,
            true,
            Some(system::RuntimeToolSource::System)
        ));
        assert!(runtime_update_supported(
            true,
            true,
            Some(system::RuntimeToolSource::Custom)
        ));
        assert!(!runtime_update_supported(
            false,
            false,
            Some(system::RuntimeToolSource::System)
        ));
        assert!(!runtime_update_supported(
            false,
            false,
            Some(system::RuntimeToolSource::Custom)
        ));
        assert!(runtime_update_supported(false, true, None));
    }
}
