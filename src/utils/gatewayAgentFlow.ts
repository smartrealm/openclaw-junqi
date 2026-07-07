export const MAIN_GATEWAY_AGENT_ID = 'main';

export const GATEWAY_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface GatewayAgentDraft {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
  inheritWorkspace?: boolean;
}

export interface GatewayAgentCreatePayload {
  id: string;
  name?: string;
  model?: string;
  workspace?: string;
}

export interface GatewayAgentConfigEntry {
  id: string;
  name?: string;
  model?: { primary?: string };
  workspace?: string;
}

export function normalizeGatewayAgentId(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '-');
}

export function isValidGatewayAgentId(value: string): boolean {
  return GATEWAY_AGENT_ID_RE.test(value);
}

export function buildGatewayAgentCreatePayload(
  input: GatewayAgentDraft,
  defaultWorkspace = '',
): GatewayAgentCreatePayload {
  const payload: GatewayAgentCreatePayload = {
    id: normalizeGatewayAgentId(input.id),
  };
  const name = String(input.name ?? '').trim();
  const model = String(input.model ?? '').trim();
  const workspace = String(input.workspace ?? '').trim()
    || (input.inheritWorkspace ? defaultWorkspace.trim() : '');
  if (name) payload.name = name;
  if (model) payload.model = model;
  if (workspace) payload.workspace = workspace;
  return payload;
}

export function buildGatewayAgentConfigEntry(input: GatewayAgentDraft): GatewayAgentConfigEntry {
  const id = normalizeGatewayAgentId(input.id);
  const name = String(input.name ?? '').trim();
  const model = String(input.model ?? '').trim();
  const workspace = String(input.workspace ?? '').trim();
  return {
    id,
    name: name || undefined,
    model: model ? { primary: model } : undefined,
    workspace: workspace || undefined,
  };
}

export function ensureMainGatewayAgentInList<T extends { id?: string }>(
  input: T[] | undefined,
  mainDefaults: T,
): T[] {
  const list = Array.isArray(input) ? input : [];
  const mainInList = list.find((agent) => agent?.id === MAIN_GATEWAY_AGENT_ID);
  const normalizedMain = mainInList && typeof mainInList === 'object'
    ? { ...mainDefaults, ...mainInList, id: MAIN_GATEWAY_AGENT_ID }
    : { ...mainDefaults, id: MAIN_GATEWAY_AGENT_ID };
  const others = list.filter((agent) => {
    const agentId = String(agent?.id ?? '').trim();
    return agentId.length > 0 && agentId !== MAIN_GATEWAY_AGENT_ID;
  });
  return [normalizedMain as T, ...others];
}
