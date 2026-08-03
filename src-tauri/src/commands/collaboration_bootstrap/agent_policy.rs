use super::BootstrapConfigureParams;
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AgentRegistryEntry {
    pub(super) id: String,
    pub(super) list_index: usize,
    pub(super) allow_agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct AgentRegistry {
    pub(super) entries: HashMap<String, AgentRegistryEntry>,
    pub(super) configured_ids: Vec<String>,
    pub(super) default_allow_agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ValidatedAgentConfiguration {
    pub(super) coordinator_agent_id: String,
    pub(super) allowed_agent_ids: Vec<String>,
    pub(super) configured_agent_ids: Vec<String>,
    pub(super) coordinator_policy_path: Option<String>,
    pub(super) coordinator_allow_agents_update: Option<Vec<String>>,
}

pub(super) fn normalize_agent_id(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_hyphen = false;
    for character in value.trim().to_ascii_lowercase().chars() {
        let accepted = character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '_' | '-');
        if accepted {
            normalized.push(character);
            previous_hyphen = character == '-';
        } else if !normalized.is_empty() && !previous_hyphen {
            normalized.push('-');
            previous_hyphen = true;
        }
    }
    normalized.trim_matches('-').to_string()
}

pub(super) fn parse_allow_agents(
    container: Option<&Value>,
    label: &str,
) -> Result<Option<Vec<String>>, String> {
    let Some(container) = container else {
        return Ok(None);
    };
    let object = container
        .as_object()
        .ok_or_else(|| format!("{label} must be an object"))?;
    let Some(value) = object.get("allowAgents") else {
        return Ok(None);
    };
    let list = value
        .as_array()
        .ok_or_else(|| format!("{label}.allowAgents must be an array"))?;
    let mut result = Vec::with_capacity(list.len());
    for entry in list {
        let value = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("{label}.allowAgents contains an invalid agent id"))?;
        result.push(value.to_string());
    }
    Ok(Some(result))
}

pub(super) fn parse_agent_registry(value: &Value) -> Result<AgentRegistry, String> {
    let agents = value
        .as_object()
        .ok_or_else(|| "OpenClaw agents config must be an object".to_string())?;
    let defaults = agents
        .get("defaults")
        .and_then(Value::as_object)
        .and_then(|value| value.get("subagents"));
    let default_allow_agents = parse_allow_agents(defaults, "agents.defaults.subagents")?;
    let list = agents
        .get("list")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenClaw agents.list must be an explicit array".to_string())?;
    if list.is_empty() {
        return Err("OpenClaw agents.list must contain at least one configured agent".to_string());
    }

    let mut entries = HashMap::new();
    for (index, value) in list.iter().enumerate() {
        let object = value
            .as_object()
            .ok_or_else(|| format!("agents.list[{index}] must be an object"))?;
        let raw_id = object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("agents.list[{index}].id is required"))?;
        let id = normalize_agent_id(raw_id);
        if id.is_empty() {
            return Err(format!("agents.list[{index}].id is invalid"));
        }
        let allow_agents = parse_allow_agents(
            object.get("subagents"),
            &format!("agents.list[{index}].subagents"),
        )?;
        if entries
            .insert(
                id.clone(),
                AgentRegistryEntry {
                    id: id.clone(),
                    list_index: index,
                    allow_agents,
                },
            )
            .is_some()
        {
            return Err(format!(
                "agents.list contains duplicate normalized agent id {id}"
            ));
        }
    }
    let mut configured_ids = entries.keys().cloned().collect::<Vec<_>>();
    configured_ids.sort();
    Ok(AgentRegistry {
        entries,
        configured_ids,
        default_allow_agents,
    })
}

pub(super) fn normalize_requested_agent_ids(
    values: &[String],
) -> Result<Vec<String>, (String, String)> {
    if values.is_empty() {
        return Err((
            "ALLOWED_AGENTS_REQUIRED".to_string(),
            "Select at least one explicit collaboration agent".to_string(),
        ));
    }
    if values.len() > 64 {
        return Err((
            "TOO_MANY_ALLOWED_AGENTS".to_string(),
            "At most 64 collaboration agents can be configured".to_string(),
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        let trimmed = value.trim();
        if trimmed == "*" {
            return Err((
                "WILDCARD_AGENT_FORBIDDEN".to_string(),
                "Collaboration requires explicit allowed agent ids; wildcard authorization is forbidden"
                    .to_string(),
            ));
        }
        let id = normalize_agent_id(trimmed);
        if id.is_empty() || id.len() > 128 {
            return Err((
                "AGENT_ID_INVALID".to_string(),
                "Every allowed agent id must be a valid OpenClaw agent id".to_string(),
            ));
        }
        if !seen.insert(id.clone()) {
            return Err((
                "DUPLICATE_AGENT_ID".to_string(),
                format!("Agent {id} appears more than once after OpenClaw normalization"),
            ));
        }
        normalized.push(id);
    }
    Ok(normalized)
}

pub(super) fn validate_agent_configuration(
    params: &BootstrapConfigureParams,
    registry: &AgentRegistry,
) -> Result<ValidatedAgentConfiguration, (String, String)> {
    let coordinator_agent_id = normalize_agent_id(&params.coordinator_agent_id);
    if coordinator_agent_id.is_empty() || coordinator_agent_id.len() > 128 {
        return Err((
            "COORDINATOR_AGENT_INVALID".to_string(),
            "A valid coordinator agent id is required".to_string(),
        ));
    }
    let Some(coordinator) = registry.entries.get(&coordinator_agent_id) else {
        return Err((
            "COORDINATOR_AGENT_NOT_CONFIGURED".to_string(),
            format!(
                "Coordinator agent {coordinator_agent_id} is not present in OpenClaw agents.list"
            ),
        ));
    };
    let allowed_agent_ids = normalize_requested_agent_ids(&params.allowed_agent_ids)?;
    if !allowed_agent_ids
        .iter()
        .any(|agent_id| agent_id == &coordinator_agent_id)
    {
        return Err((
            "COORDINATOR_NOT_ALLOWED".to_string(),
            "The coordinator must be included in the explicit plugin allowlist".to_string(),
        ));
    }
    let missing = allowed_agent_ids
        .iter()
        .filter(|agent_id| !registry.entries.contains_key(*agent_id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err((
            "ALLOWED_AGENT_NOT_CONFIGURED".to_string(),
            format!(
                "The following agents are not present in OpenClaw agents.list: {}",
                missing.join(", ")
            ),
        ));
    }

    let effective_policy = coordinator
        .allow_agents
        .as_ref()
        .or(registry.default_allow_agents.as_ref());
    let policy_allows_all =
        effective_policy.is_some_and(|entries| entries.iter().any(|entry| entry.trim() == "*"));
    let policy_ids = effective_policy
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.trim() != "*")
                .map(|entry| normalize_agent_id(entry))
                .filter(|entry| registry.entries.contains_key(entry))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_else(|| HashSet::from([coordinator.id.clone()]));
    let denied = allowed_agent_ids
        .iter()
        .filter(|agent_id| !policy_allows_all && !policy_ids.contains(*agent_id))
        .cloned()
        .collect::<Vec<_>>();
    let (coordinator_policy_path, coordinator_allow_agents_update) = if denied.is_empty() {
        (None, None)
    } else {
        let mut expanded = effective_policy
            .cloned()
            .unwrap_or_else(|| vec![coordinator.id.clone()]);
        let mut expanded_ids = expanded
            .iter()
            .filter(|entry| entry.trim() != "*")
            .map(|entry| normalize_agent_id(entry))
            .collect::<HashSet<_>>();
        for agent_id in &allowed_agent_ids {
            if expanded_ids.insert(agent_id.clone()) {
                expanded.push(agent_id.clone());
            }
        }
        (
            Some(format!(
                "agents.list[{}].subagents.allowAgents",
                coordinator.list_index
            )),
            Some(expanded),
        )
    };
    Ok(ValidatedAgentConfiguration {
        coordinator_agent_id,
        allowed_agent_ids,
        configured_agent_ids: registry.configured_ids.clone(),
        coordinator_policy_path,
        coordinator_allow_agents_update,
    })
}
