export interface DashboardDailyCostEntry {
  date?: unknown;
  totalCost?: unknown;
  inputCost?: unknown;
  outputCost?: unknown;
  cacheReadCost?: unknown;
  cacheWriteCost?: unknown;
}

export interface DashboardCostChartPoint {
  date: string;
  input: number;
  output: number;
  cache: number;
  other: number;
  total: number;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

export function buildDailyCostChartData(
  entries: DashboardDailyCostEntry[],
  limit = 14,
): DashboardCostChartPoint[] {
  return entries
    .filter((entry): entry is DashboardDailyCostEntry & { date: string } => (
      typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-Math.max(0, limit))
    .map((entry) => {
      const input = nonNegativeNumber(entry.inputCost);
      const output = nonNegativeNumber(entry.outputCost);
      const cache = nonNegativeNumber(entry.cacheReadCost) + nonNegativeNumber(entry.cacheWriteCost);
      const knownCost = input + output + cache;
      const total = Math.max(nonNegativeNumber(entry.totalCost), knownCost);
      return {
        date: entry.date.slice(5),
        input,
        output,
        cache,
        other: Math.max(0, total - knownCost),
        total,
      };
    });
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatActivityTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '—';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatActivityTimeTitle(timestamp: number): string | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function shortModelName(model: unknown): string {
  if (typeof model !== 'string' || !model.trim()) return '—';
  const normalized = model.trim();
  return normalized.split('/').filter(Boolean).pop() || normalized;
}
