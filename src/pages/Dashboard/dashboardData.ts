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

export interface DashboardTokenUsageOverview {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  unclassifiedTokens: number;
  activeDays: number;
  latestActivityDate: string | null;
  hasTrend: boolean;
}

export type DashboardChartMetric = 'cost' | 'tokens';
export type DashboardChartMetricPreference = 'auto' | DashboardChartMetric;

export function resolveDashboardChartMetric(
  preference: DashboardChartMetricPreference,
  availability: DashboardCostAvailability,
  tokenOverview: DashboardTokenUsageOverview,
): DashboardChartMetric {
  const tokenUsageAvailable = availability.totalTokens > 0;
  if (preference === 'cost' && availability.hasPricedCost) return 'cost';
  if (preference === 'tokens' && tokenUsageAvailable) return 'tokens';
  if (availability.missingCostEntries > 0 && tokenOverview.hasTrend) return 'tokens';
  if (availability.hasPricedCost) return 'cost';
  return 'tokens';
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

type DatedDashboardDailyCostEntry = DashboardDailyCostEntry & { date: string };

function recentDatedEntries(
  entries: DashboardDailyCostEntry[],
  limit: number,
): DatedDashboardDailyCostEntry[] {
  return entries
    .filter((entry): entry is DatedDashboardDailyCostEntry => (
      typeof entry?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-Math.max(0, limit));
}

function knownCost(entry: DashboardDailyCostEntry): number {
  const componentCost = nonNegativeNumber(entry.inputCost)
    + nonNegativeNumber(entry.outputCost)
    + nonNegativeNumber(entry.cacheReadCost)
    + nonNegativeNumber(entry.cacheWriteCost);
  return Math.max(nonNegativeNumber(entry.totalCost), componentCost);
}

function tokenTotal(entry: DashboardDailyCostEntry): number {
  const componentTokens = nonNegativeNumber(entry.input)
    + nonNegativeNumber(entry.output)
    + nonNegativeNumber(entry.cacheRead)
    + nonNegativeNumber(entry.cacheWrite);
  return Math.max(nonNegativeNumber(entry.totalTokens), componentTokens);
}

export function buildDailyCostChartData(
  entries: DashboardDailyCostEntry[],
  limit = 14,
): DashboardCostChartPoint[] {
  return recentDatedEntries(entries, limit)
    .map((entry) => {
      const input = nonNegativeNumber(entry.inputCost);
      const output = nonNegativeNumber(entry.outputCost);
      const cache = nonNegativeNumber(entry.cacheReadCost) + nonNegativeNumber(entry.cacheWriteCost);
      const componentCost = input + output + cache;
      const total = knownCost(entry);
      const inputTokens = nonNegativeNumber(entry.input);
      const outputTokens = nonNegativeNumber(entry.output);
      const cacheTokens = nonNegativeNumber(entry.cacheRead) + nonNegativeNumber(entry.cacheWrite);
      return {
        date: entry.date.slice(5),
        input,
        output,
        cache,
        other: Math.max(0, total - componentCost),
        total,
        inputTokens,
        outputTokens,
        cacheTokens,
        totalTokens: tokenTotal(entry),
      };
    });
}

/**
 * 费用与 Token 用量是两类独立信号。Provider 未配置价格时，OpenClaw 仍可能返回完整
 * Token 记录，因此仪表盘必须解释未估价状态，不能把空费用图当成真实的零费用。
 */
export function getDailyCostAvailability(
  entries: DashboardDailyCostEntry[],
  limit = 14,
): DashboardCostAvailability {
  const recent = recentDatedEntries(entries, limit);

  return recent.reduce<DashboardCostAvailability>((summary, entry) => ({
    hasDatedEntries: true,
    hasPricedCost: summary.hasPricedCost || knownCost(entry) > 0,
    totalTokens: summary.totalTokens + tokenTotal(entry),
    missingCostEntries: summary.missingCostEntries + nonNegativeNumber(entry.missingCostEntries),
  }), {
    hasDatedEntries: false,
    hasPricedCost: false,
    totalTokens: 0,
    missingCostEntries: 0,
  });
}

/**
 * 单个日期桶包含有效用量，但不足以形成有意义的趋势。该判断保留在图表组件之外，
 * 让仪表盘可以展示已记录用量，同时不虚构趋势。
 */
export function getDashboardTokenUsageOverview(
  data: DashboardCostChartPoint[],
): DashboardTokenUsageOverview {
  const totals = data.reduce((summary, point) => {
    const inputTokens = summary.inputTokens + point.inputTokens;
    const outputTokens = summary.outputTokens + point.outputTokens;
    const cacheTokens = summary.cacheTokens + point.cacheTokens;
    const totalTokens = summary.totalTokens + point.totalTokens;
    const classifiedTokens = point.inputTokens + point.outputTokens + point.cacheTokens;

    return {
      totalTokens,
      inputTokens,
      outputTokens,
      cacheTokens,
      unclassifiedTokens: summary.unclassifiedTokens + Math.max(0, point.totalTokens - classifiedTokens),
      activeDays: summary.activeDays + (point.totalTokens > 0 ? 1 : 0),
      latestActivityDate: point.totalTokens > 0 ? point.date : summary.latestActivityDate,
    };
  }, {
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    unclassifiedTokens: 0,
    activeDays: 0,
    latestActivityDate: null as string | null,
  });

  const plottedDays = data.filter((point) => (
    point.inputTokens + point.outputTokens + point.cacheTokens > 0
  )).length;

  return {
    ...totals,
    hasTrend: plottedDays >= 2,
  };
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
