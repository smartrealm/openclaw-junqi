export interface DashboardDailyCostEntry {
  date?: unknown;
  totalCost?: unknown;
  inputCost?: unknown;
  outputCost?: unknown;
  cacheReadCost?: unknown;
  cacheWriteCost?: unknown;
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
  missingCostEntries?: unknown;
}

export interface DashboardCostChartPoint {
  date: string;
  input: number;
  output: number;
  cache: number;
  other: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
}

export interface DashboardCostAvailability {
  hasDatedEntries: boolean;
  hasPricedCost: boolean;
  totalTokens: number;
  missingCostEntries: number;
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
      const inputTokens = nonNegativeNumber(entry.input);
      const outputTokens = nonNegativeNumber(entry.output);
      const cacheTokens = nonNegativeNumber(entry.cacheRead) + nonNegativeNumber(entry.cacheWrite);
      return {
        date: entry.date.slice(5),
        input,
        output,
        cache,
        other: Math.max(0, total - knownCost),
        total,
        inputTokens,
        outputTokens,
        cacheTokens,
        totalTokens: Math.max(nonNegativeNumber(entry.totalTokens), inputTokens + outputTokens + cacheTokens),
      };
    });
}

/**
 * Cost and token usage are different signals. OpenClaw can have complete token
 * records while a provider has no configured pricing, so the dashboard must
 * explain that state instead of rendering an empty $0 chart as real cost data.
 */
export function getDailyCostAvailability(
  entries: DashboardDailyCostEntry[],
  limit = 14,
): DashboardCostAvailability {
  const recent = entries
    .filter((entry): entry is DashboardDailyCostEntry & { date: string } => (
      typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-Math.max(0, limit));

  return recent.reduce<DashboardCostAvailability>((summary, entry) => ({
    hasDatedEntries: true,
    hasPricedCost: summary.hasPricedCost || nonNegativeNumber(entry.totalCost) > 0,
    totalTokens: summary.totalTokens + nonNegativeNumber(entry.totalTokens),
    missingCostEntries: summary.missingCostEntries + nonNegativeNumber(entry.missingCostEntries),
  }), {
    hasDatedEntries: false,
    hasPricedCost: false,
    totalTokens: 0,
    missingCostEntries: 0,
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
