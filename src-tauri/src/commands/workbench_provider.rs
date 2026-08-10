use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    provider_id: String,
    label: String,
    available: bool,
    binary_path: Option<String>,
}

#[tauri::command]
pub fn probe_workbench_providers() -> Vec<ProviderCapability> {
    super::agent_task_pty::workbench_agent_specs()
        .iter()
        .map(|spec| {
            let path = crate::platform::detect_path(spec.bin);
            ProviderCapability {
                provider_id: spec.bin.to_string(),
                label: spec.label.to_string(),
                available: !path.is_empty(),
                binary_path: (!path.is_empty()).then_some(path),
            }
        })
        .collect()
}
