export interface OfficialProviderCatalogModel {
  key: string;
  name: string;
  input?: string;
  contextWindow?: number;
  local?: boolean;
  available?: boolean;
  tags?: string[];
  missing?: boolean;
}

export interface OfficialProviderCatalog {
  version?: string;
  models: OfficialProviderCatalogModel[];
}

export type OfficialProbeStatus =
  | 'ok'
  | 'auth'
  | 'rate_limit'
  | 'billing'
  | 'timeout'
  | 'format'
  | 'unknown'
  | 'no_model';

export interface ProviderProbeSummary {
  ok: boolean;
  status: OfficialProbeStatus;
  reasonCode?: string;
  detail?: string;
}

export interface ProviderProbeRequest {
  providerId: string;
  profileKey?: string;
}

export type OfficialProviderCatalogReader = () => Promise<OfficialProviderCatalog>;

export function createOfficialProviderCatalogLoader(
  readCatalog: OfficialProviderCatalogReader,
): () => Promise<OfficialProviderCatalog> {
  return () => readCatalog();
}

/**
 * Read the catalog from the currently selected OpenClaw runtime.
 *
 * A catalog is coupled to the selected Native/Docker runtime and its installed
 * OpenClaw version. Keeping it in a module cache let an earlier runtime's
 * models authorize a later one, so callers intentionally receive a fresh
 * runtime snapshot for each request.
 */
export function normalizeOfficialProviderCatalog(payload: unknown): OfficialProviderCatalog {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { models: [] };
  const root = payload as Record<string, unknown>;
  const models = Array.isArray(root.models) ? root.models.flatMap((model) => {
    if (!model || typeof model !== 'object' || Array.isArray(model)) return [];
    const row = model as Record<string, unknown>;
    if (typeof row.key !== 'string' || !row.key.trim()) return [];
    if (typeof row.name !== 'string' || !row.name.trim()) return [];
    return [{
      key: row.key,
      name: row.name,
      ...(typeof row.input === 'string' ? { input: row.input } : {}),
      ...(typeof row.contextWindow === 'number' && Number.isFinite(row.contextWindow)
        ? { contextWindow: row.contextWindow }
        : {}),
      ...(typeof row.local === 'boolean' ? { local: row.local } : {}),
      ...(typeof row.available === 'boolean' ? { available: row.available } : {}),
      ...(Array.isArray(row.tags)
        ? { tags: row.tags.filter((tag): tag is string => typeof tag === 'string') }
        : {}),
      ...(typeof row.missing === 'boolean' ? { missing: row.missing } : {}),
    }];
  }) : [];
  return {
    ...(typeof root.version === 'string' && root.version.trim() ? { version: root.version } : {}),
    models,
  };
}

export const loadOfficialProviderCatalog = createOfficialProviderCatalogLoader(
  async () => normalizeOfficialProviderCatalog(await getOpenclawProviderCatalog()),
);

export interface OfficialProviderAuthProfile {
  id: string;
  provider: string;
  type: string;
  label?: string;
}

export function normalizeOfficialProviderAuthProfiles(payload: unknown): OfficialProviderAuthProfile[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const profiles = (payload as Record<string, unknown>).profiles;
  if (!Array.isArray(profiles)) return [];
  return profiles.flatMap((profile) => {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return [];
    const row = profile as Record<string, unknown>;
    if (typeof row.id !== 'string' || !row.id.trim()) return [];
    if (typeof row.provider !== 'string' || !row.provider.trim()) return [];
    if (typeof row.type !== 'string' || !row.type.trim()) return [];
    return [{
      id: row.id,
      provider: row.provider,
      type: row.type,
      ...(typeof row.label === 'string' && row.label.trim() ? { label: row.label } : {}),
    }];
  });
}

export async function loadOfficialProviderAuthProfiles(
  provider?: string,
): Promise<OfficialProviderAuthProfile[]> {
  return normalizeOfficialProviderAuthProfiles(await getOpenclawAuthProfiles(provider));
}

export async function probeOfficialProviderCandidate(
  config: unknown,
  request: ProviderProbeRequest,
): Promise<ProviderProbeSummary> {
  return summarizeOfficialProviderProbe(await probeOpenclawProvider(
    config,
    request.providerId,
    request.profileKey,
  ));
}

const PROBE_STATUSES = new Set<OfficialProbeStatus>([
  'ok',
  'auth',
  'rate_limit',
  'billing',
  'timeout',
  'format',
  'unknown',
  'no_model',
]);

function collectProbeRows(value: unknown, rows: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectProbeRows(item, rows);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status === 'string' && PROBE_STATUSES.has(status as OfficialProbeStatus)) {
    rows.push(record);
  }
  for (const nested of Object.values(record)) collectProbeRows(nested, rows);
}

function firstText(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function summarizeOfficialProviderProbe(payload: unknown): ProviderProbeSummary {
  const rows: Record<string, unknown>[] = [];
  collectProbeRows(payload, rows);
  // Fail closed when OpenClaw reports mixed profile/model results. A successful
  // sibling must never hide the requested profile's auth failure.
  const failure = rows.find((row) => row.status !== 'ok');
  if (!failure) {
    const success = rows.find((row) => row.status === 'ok');
    if (success) {
      return {
        ok: true,
        status: 'ok',
        detail: firstText(success, ['detail', 'message']),
      };
    }
  }
  if (!failure) {
    return {
      ok: false,
      status: 'unknown',
      detail: 'OpenClaw returned no provider probe result.',
    };
  }
  return {
    ok: false,
    status: failure.status as OfficialProbeStatus,
    reasonCode: firstText(failure, ['reasonCode', 'reason_code']),
    detail: firstText(failure, ['detail', 'message', 'error']),
  };
}

export function providerCatalogModels(
  catalog: OfficialProviderCatalog,
  providerId: string,
): OfficialProviderCatalogModel[] {
  const prefix = `${providerId.trim().toLowerCase()}/`;
  return (catalog.models ?? []).filter((model) => (
    typeof model?.key === 'string' && model.key.toLowerCase().startsWith(prefix)
  ));
}
import {
  getOpenclawAuthProfiles,
  getOpenclawProviderCatalog,
  probeOpenclawProvider,
} from '@/api/tauri-commands';
