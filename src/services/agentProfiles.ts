import { invoke } from '@tauri-apps/api/core';

export const AGENT_PROFILE_ID_MAX_CHARS = 128;
export const AGENT_PROFILE_DOMAIN_MAX_CHARS = 160;
export const AGENT_PROFILE_SCOPE_MAX_CHARS = 1000;

export interface AgentProfileMetadata {
  domain: string;
  scope: string;
}

export interface AgentProfileDraft extends AgentProfileMetadata {
  agentId: string;
}

export type AgentProfileMap = Record<string, AgentProfileMetadata>;

function normalizeText(value: string): string {
  return value.trim();
}

function validateText(value: string, field: string, maxChars: number): string {
  const normalized = normalizeText(value);
  if (Array.from(normalized).length > maxChars) {
    throw new Error(`Agent profile ${field} exceeds ${maxChars} characters.`);
  }
  if (normalized.includes('\0')) {
    throw new Error(`Agent profile ${field} cannot contain NUL characters.`);
  }
  return normalized;
}

export function normalizeAgentProfileDraft(draft: AgentProfileDraft): AgentProfileDraft {
  if (/\p{Cc}/u.test(draft.agentId)) {
    throw new Error('Agent profile agent id cannot contain control characters.');
  }
  const agentId = normalizeText(draft.agentId);
  if (!agentId) throw new Error('Agent profile requires a non-empty agent id.');
  if (Array.from(agentId).length > AGENT_PROFILE_ID_MAX_CHARS) {
    throw new Error(`Agent profile agent id exceeds ${AGENT_PROFILE_ID_MAX_CHARS} characters.`);
  }
  return {
    agentId,
    domain: validateText(draft.domain, 'domain', AGENT_PROFILE_DOMAIN_MAX_CHARS),
    scope: validateText(draft.scope, 'scope', AGENT_PROFILE_SCOPE_MAX_CHARS),
  };
}

export async function loadAgentProfiles(): Promise<AgentProfileMap> {
  return invoke<AgentProfileMap>('load_agent_profiles');
}

export async function loadAgentProfile(agentId: string): Promise<AgentProfileMetadata | null> {
  const normalizedId = normalizeAgentProfileDraft({ agentId, domain: '', scope: '' }).agentId;
  const profiles = await loadAgentProfiles();
  return Object.prototype.hasOwnProperty.call(profiles, normalizedId)
    ? profiles[normalizedId]
    : null;
}

export async function saveAgentProfile(
  draft: AgentProfileDraft,
): Promise<AgentProfileMetadata | null> {
  const normalized = normalizeAgentProfileDraft(draft);
  return invoke<AgentProfileMetadata | null>('save_agent_profile', {
    agent_id: normalized.agentId,
    domain: normalized.domain,
    scope: normalized.scope,
  });
}

export async function deleteAgentProfile(agentId: string): Promise<void> {
  const normalizedId = normalizeAgentProfileDraft({ agentId, domain: '', scope: '' }).agentId;
  await invoke<void>('delete_agent_profile', { agent_id: normalizedId });
}
