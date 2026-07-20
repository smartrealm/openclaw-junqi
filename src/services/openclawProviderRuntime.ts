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

let officialCatalogPromise: Promise<OfficialProviderCatalog> | undefined;

export function loadOfficialProviderCatalog(force = false): Promise<OfficialProviderCatalog> {
  if (force || !officialCatalogPromise) {
    officialCatalogPromise = window.aegis.providerRuntime.catalog().catch((error) => {
      officialCatalogPromise = undefined;
      throw error;
    });
  }
  return officialCatalogPromise;
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
