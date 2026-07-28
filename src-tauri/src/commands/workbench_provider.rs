use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const MAX_ID_BYTES: usize = 256;
const MAX_PATH_BYTES: usize = 16 * 1024;

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

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderClaimRequest {
    claim_id: String,
    expected_claim_id: Option<String>,
    worktree_id: String,
    pane_id: String,
    pty_id: String,
    pty_run_id: String,
    provider_id: String,
    provider_session_id: Option<String>,
    transcript_path: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderClaim {
    claim_id: String,
    generation: u64,
    worktree_id: String,
    pane_id: String,
    pty_id: String,
    pty_run_id: String,
    provider_id: String,
    provider_session_id: Option<String>,
    transcript_path: Option<String>,
}

fn claims() -> &'static Mutex<HashMap<String, ProviderClaim>> {
    static CLAIMS: OnceLock<Mutex<HashMap<String, ProviderClaim>>> = OnceLock::new();
    CLAIMS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn release_claims_for_pty_locked(pty_id: &str) {
    if let Ok(mut entries) = claims().lock() {
        entries.retain(|_, claim| claim.pty_id != pty_id);
    }
}

pub(crate) fn clear_claims_locked() {
    if let Ok(mut entries) = claims().lock() {
        entries.clear();
    }
}

fn validate_component(label: &str, value: &str, max: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > max || value.bytes().any(|byte| byte.is_ascii_control()) {
        return Err(format!("invalid provider {label}"));
    }
    Ok(())
}

fn resume_fingerprint(request: &ProviderClaimRequest) -> Option<String> {
    if request.provider_session_id.is_none() && request.transcript_path.is_none() {
        return None;
    }
    Some(format!(
        "{}\0{}\0{}\0{}",
        request.worktree_id,
        request.provider_id,
        request.provider_session_id.as_deref().unwrap_or_default(),
        request.transcript_path.as_deref().unwrap_or_default(),
    ))
}

fn claim_fingerprint(claim: &ProviderClaim) -> Option<String> {
    if claim.provider_session_id.is_none() && claim.transcript_path.is_none() {
        return None;
    }
    Some(format!(
        "{}\0{}\0{}\0{}",
        claim.worktree_id,
        claim.provider_id,
        claim.provider_session_id.as_deref().unwrap_or_default(),
        claim.transcript_path.as_deref().unwrap_or_default(),
    ))
}

fn same_claim(current: &ProviderClaim, request: &ProviderClaimRequest) -> bool {
    current.claim_id == request.claim_id
        && current.worktree_id == request.worktree_id
        && current.pane_id == request.pane_id
        && current.pty_id == request.pty_id
        && current.pty_run_id == request.pty_run_id
        && current.provider_id == request.provider_id
        && current.provider_session_id == request.provider_session_id
        && current.transcript_path == request.transcript_path
}

#[tauri::command]
pub fn claim_workbench_provider(request: ProviderClaimRequest) -> Result<ProviderClaim, String> {
    for (label, value) in [
        ("claim id", request.claim_id.as_str()),
        ("worktree id", request.worktree_id.as_str()),
        ("pane id", request.pane_id.as_str()),
        ("PTY id", request.pty_id.as_str()),
        ("PTY run id", request.pty_run_id.as_str()),
        ("provider id", request.provider_id.as_str()),
    ] {
        validate_component(label, value, MAX_ID_BYTES)?;
    }
    if let Some(value) = request.provider_session_id.as_deref() {
        validate_component("session id", value, MAX_ID_BYTES)?;
    }
    if let Some(value) = request.transcript_path.as_deref() {
        validate_component("transcript path", value, MAX_PATH_BYTES)?;
    }

    let _operation = super::workbench_pty::lifecycle_gate()
        .lock()
        .map_err(|_| "workbench provider lifecycle lock poisoned".to_string())?;
    super::workbench_pty::assert_current_run_locked(&request.pty_id, &request.pty_run_id)?;
    let mut entries = claims()
        .lock()
        .map_err(|_| "workbench provider registry lock poisoned".to_string())?;
    let current = entries.get(&request.pane_id).cloned();
    if current
        .as_ref()
        .is_some_and(|claim| same_claim(claim, &request))
    {
        return Ok(current.unwrap());
    }
    match (&current, request.expected_claim_id.as_deref()) {
        (Some(claim), Some(expected)) if claim.claim_id == expected => {}
        (Some(_), Some(_)) => return Err("stale provider claim replacement".into()),
        (Some(_), None) => return Err("provider pane is already claimed".into()),
        (None, Some(_)) => return Err("stale provider claim replacement".into()),
        (None, None) => {}
    }
    let resume = resume_fingerprint(&request);
    for claim in entries.values() {
        if claim.pane_id == request.pane_id {
            continue;
        }
        if claim.pty_id == request.pty_id || claim.pty_run_id == request.pty_run_id {
            return Err("provider PTY is already claimed".into());
        }
        if resume.is_some() && claim_fingerprint(claim) == resume {
            return Err("provider resume identity is already claimed".into());
        }
    }
    let claim = ProviderClaim {
        claim_id: request.claim_id,
        generation: current
            .as_ref()
            .map_or(1, |claim| claim.generation.saturating_add(1)),
        worktree_id: request.worktree_id,
        pane_id: request.pane_id,
        pty_id: request.pty_id,
        pty_run_id: request.pty_run_id,
        provider_id: request.provider_id,
        provider_session_id: request.provider_session_id,
        transcript_path: request.transcript_path,
    };
    entries.insert(claim.pane_id.clone(), claim.clone());
    Ok(claim)
}

#[tauri::command]
pub fn release_workbench_provider(
    pane_id: String,
    claim_id: String,
    generation: u64,
) -> Result<bool, String> {
    validate_component("pane id", &pane_id, MAX_ID_BYTES)?;
    validate_component("claim id", &claim_id, MAX_ID_BYTES)?;
    let _operation = super::workbench_pty::lifecycle_gate()
        .lock()
        .map_err(|_| "workbench provider lifecycle lock poisoned".to_string())?;
    let mut entries = claims()
        .lock()
        .map_err(|_| "workbench provider registry lock poisoned".to_string())?;
    let matches = entries
        .get(&pane_id)
        .is_some_and(|claim| claim.claim_id == claim_id && claim.generation == generation);
    if matches {
        entries.remove(&pane_id);
    }
    Ok(matches)
}

#[cfg(test)]
mod tests {
    use super::{resume_fingerprint, validate_component, ProviderClaimRequest, MAX_ID_BYTES};

    fn request() -> ProviderClaimRequest {
        ProviderClaimRequest {
            claim_id: "claim".into(),
            expected_claim_id: None,
            worktree_id: "worktree".into(),
            pane_id: "pane".into(),
            pty_id: "pty".into(),
            pty_run_id: "run".into(),
            provider_id: "claude".into(),
            provider_session_id: Some("session".into()),
            transcript_path: Some("/repo/session.jsonl".into()),
        }
    }

    #[test]
    fn provider_components_are_bounded_and_control_free() {
        assert!(validate_component("id", "", MAX_ID_BYTES).is_err());
        assert!(validate_component("id", "bad\n", MAX_ID_BYTES).is_err());
        assert!(validate_component("id", &"x".repeat(MAX_ID_BYTES + 1), MAX_ID_BYTES).is_err());
    }

    #[test]
    fn resume_fingerprint_includes_all_ownership_dimensions() {
        let base = request();
        let mut other = request();
        other.worktree_id = "other".into();
        assert_ne!(resume_fingerprint(&base), resume_fingerprint(&other));
        other = request();
        other.provider_id = "codex".into();
        assert_ne!(resume_fingerprint(&base), resume_fingerprint(&other));
    }
}
