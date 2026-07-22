export interface AgentShareMetadata {
  id: string;
  name: string;
  definition: Record<string, unknown>;
}

export interface ImportedAgentShareDefinition extends AgentShareMetadata {}

const SHAREABLE_AGENT_FIELDS = [
  'name',
  'model',
  'imageModel',
  'imageGenerationModel',
  'videoGenerationModel',
  'utilityModel',
  'models',
  'modelPolicy',
  'thinkingDefault',
  'maxConcurrent',
  'subagents',
  'heartbeat',
  'contextPruning',
  'compaction',
  'identity',
  'tools',
  'sandbox',
  'skills',
  'runtime',
  'session',
  'memorySearch',
  'bootstrap',
] as const;

const SENSITIVE_FIELD = /(api.?key|access.?token|auth.?token|secret|password|credential|authorization|cookie|private.?key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneShareableValue(value: unknown, depth = 0): unknown {
  if (depth > 12 || value === null) return value === null ? null : undefined;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    return value
      .map((entry) => cloneShareableValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (!isRecord(value)) return undefined;

  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_FIELD.test(key)) continue;
    const cloned = cloneShareableValue(entry, depth + 1);
    if (cloned !== undefined) next[key] = cloned;
  }
  return next;
}

function shareableDefinition(value: unknown): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const next: Record<string, unknown> = {};
  for (const field of SHAREABLE_AGENT_FIELDS) {
    const cloned = cloneShareableValue(source[field]);
    if (cloned !== undefined) next[field] = cloned;
  }
  return next;
}

export function buildAgentShareMetadata(input: {
  id: string;
  name?: string;
  model?: unknown;
  definition?: unknown;
}): AgentShareMetadata {
  const definition = shareableDefinition(input.definition);
  const fallbackModel = cloneShareableValue(input.model);
  if (definition.model === undefined && fallbackModel !== undefined) {
    definition.model = fallbackModel;
  }

  const id = input.id.trim();
  const configuredName = typeof definition.name === 'string' ? definition.name.trim() : '';
  const name = input.name?.trim() || configuredName || id;
  definition.name = name;

  return { id, name, definition };
}

export function readImportedAgentShareMetadata(metadata: unknown): ImportedAgentShareDefinition | null {
  if (!isRecord(metadata) || !isRecord(metadata.agent)) return null;
  const source = metadata.agent;
  const id = typeof source.id === 'string' ? source.id.trim() : '';
  if (!id) return null;

  const definition = shareableDefinition(source.definition);
  if (definition.model === undefined) {
    const legacyModel = cloneShareableValue(source.model);
    if (legacyModel !== undefined) definition.model = legacyModel;
  }

  const configuredName = typeof definition.name === 'string' ? definition.name.trim() : '';
  const name = typeof source.name === 'string' && source.name.trim()
    ? source.name.trim()
    : configuredName || id;
  definition.name = name;

  return { id, name, definition };
}

/** Imported workspaces are portable; always bind their definition to the chosen target. */
export function buildImportedAgentConfigEntry(
  agent: ImportedAgentShareDefinition,
  workspace: string,
): Record<string, unknown> {
  return {
    ...agent.definition,
    id: agent.id,
    name: agent.name,
    workspace: workspace.trim(),
  };
}
