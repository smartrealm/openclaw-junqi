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
  workspace?: string;
  model?: string;
}

/**
 * The official `agents.create` RPC derives the internal id from `name`.
 * JunQi keeps those concepts separate, so the gateway service adapts this
 * domain payload into the official create-then-update sequence.
 */
export interface GatewayAgentDisplayNameUpdate {
  agentId: string;
  name: string;
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

/**
 * OpenClaw agents should not accidentally share the main workspace. The CLI's
 * conventional layout is `workspace-<agentId>` next to the default workspace;
 * this only suggests that path, and the user can still edit it before create.
 */
export function suggestDedicatedGatewayAgentWorkspace(
  defaultWorkspace: string | undefined,
  agentId: string | undefined,
): string {
  const base = String(defaultWorkspace ?? '').trim();
  const id = normalizeGatewayAgentId(String(agentId ?? ''));
  if (!base || !id || !GATEWAY_AGENT_ID_RE.test(id)) return '';

  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const withoutTrailingSeparator = base.replace(/[\\/]+$/, '') || (separator === '\\' ? '\\' : '/');
  const parts = withoutTrailingSeparator.split(/[\\/]/);
  const leaf = parts[parts.length - 1] ?? '';
  const suggestedLeaf = `workspace-${id}`;

  if (/^workspace(?:-[a-z0-9_-]+)?$/i.test(leaf)) {
    const parent = parts.slice(0, -1).join(separator);
    if (!parent) return `${separator}${suggestedLeaf}`;
    return `${parent}${separator}${suggestedLeaf}`;
  }
  return `${withoutTrailingSeparator}-${id}`;
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
  // OpenClaw's official create RPC requires a workspace. An empty field means
  // "use the configured default" in the JunQi wizard, regardless of whether
  // the value came from the inherit checkbox or the review step.
  const workspace = String(input.workspace ?? '').trim() || defaultWorkspace.trim();
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
