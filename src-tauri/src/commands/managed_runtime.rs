use crate::commands::{git_runtime, node_runtime, setup, system};
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

fn managed_update_supported(
    platform_supported: bool,
    available: bool,
    source: Option<system::RuntimeToolSource>,
) -> bool {
    platform_supported && (!available || source != Some(system::RuntimeToolSource::System))
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
    let node_auto_update_supported =
        managed_update_supported(capabilities.node, node.available, node.source);
    let git_auto_update_supported =
        managed_update_supported(capabilities.git, git.available, git.source);
    Ok(ManagedRuntimeStatus {
        runtime_dir: paths::runtime_dir().to_string_lossy().into_owned(),
        node,
        node_requirement: requirement.expression().to_string(),
        node_requirement_source: requirement.source().id().to_string(),
        node_auto_update_supported,
        git,
        git_auto_update_supported,
        node_download_order: if capabilities.node {
            node_runtime::node_download_order()
        } else {
            Vec::new()
        },
        git_download_order: if capabilities.git {
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
    fn bug_rp_01_system_tools_do_not_offer_an_ineffective_managed_update() {
        assert!(!managed_update_supported(
            true,
            true,
            Some(system::RuntimeToolSource::System)
        ));
        assert!(managed_update_supported(
            true,
            true,
            Some(system::RuntimeToolSource::Managed)
        ));
        assert!(managed_update_supported(
            true,
            true,
            Some(system::RuntimeToolSource::Custom)
        ));
        assert!(managed_update_supported(true, false, None));
        assert!(!managed_update_supported(false, false, None));
    }
}
