export interface OpenClawCronStatusSummary {
  enabled: boolean;
  storePath: string;
  storage: 'sqlite';
  sqlitePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
}

interface CronStatusRequester {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`cron.status returned an invalid ${field}`);
  }
  return value;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`cron.status returned an invalid ${field}`);
  }
  return value as number;
}

function parseNextWakeAtMs(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error('cron.status returned an invalid nextWakeAtMs');
  }
  return value as number;
}

export function parseCronStatus(value: unknown): OpenClawCronStatusSummary {
  if (!isRecord(value)
    || typeof value.enabled !== 'boolean'
    || value.storage !== 'sqlite'
    || !('nextWakeAtMs' in value)) {
    throw new Error('cron.status returned an invalid summary');
  }

  return {
    enabled: value.enabled,
    storePath: requiredString(value.storePath, 'storePath'),
    storage: 'sqlite',
    sqlitePath: requiredString(value.sqlitePath, 'sqlitePath'),
    jobs: requiredNonNegativeInteger(value.jobs, 'jobs'),
    nextWakeAtMs: parseNextWakeAtMs(value.nextWakeAtMs),
  };
}

export async function getCronStatus(request: CronStatusRequester): Promise<OpenClawCronStatusSummary> {
  return parseCronStatus(await request('cron.status', {}));
}
