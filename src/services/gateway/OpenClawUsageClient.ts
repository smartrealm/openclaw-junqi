type UnknownRecord = Readonly<Record<string, unknown>>;

export interface OpenClawCostUsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
  missingCostByModel?: Readonly<Record<string, number>>;
}

export interface OpenClawUsageCacheStatus {
  status: 'fresh' | 'partial' | 'stale' | 'refreshing';
  cachedFiles: number;
  pendingFiles: number;
  staleFiles: number;
  refreshedAt?: number;
}

export interface OpenClawCostUsageDailyEntry extends OpenClawCostUsageTotals {
  date: string;
}

export interface OpenClawCostUsageSummary {
  updatedAt: number;
  days: number;
  daily: OpenClawCostUsageDailyEntry[];
  totals: OpenClawCostUsageTotals;
  cacheStatus?: OpenClawUsageCacheStatus;
}

export interface OpenClawSessionMessageCounts {
  total: number;
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
}

export interface OpenClawSessionToolUsage {
  totalCalls: number;
  uniqueTools: number;
  tools: Array<{ name: string; count: number }>;
}

export interface OpenClawSessionModelUsage {
  provider?: string;
  model?: string;
  count: number;
  totals: OpenClawCostUsageTotals;
}

export interface OpenClawSessionLatencyStats {
  count: number;
  avgMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

export interface OpenClawSessionDailyLatency extends OpenClawSessionLatencyStats {
  date: string;
}

export interface OpenClawSessionDailyUsage {
  date: string;
  tokens: number;
  cost: number;
}

export interface OpenClawSessionDailyMessageCounts extends OpenClawSessionMessageCounts {
  date: string;
}

export interface OpenClawSessionUtcQuarterHourMessageCounts extends OpenClawSessionMessageCounts {
  date: string;
  quarterIndex: number;
}

export interface OpenClawSessionUtcQuarterHourTokenUsage {
  date: string;
  quarterIndex: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
}

export interface OpenClawSessionDailyModelUsage {
  date: string;
  provider?: string;
  model?: string;
  tokens: number;
  cost: number;
  count: number;
}

export interface OpenClawSessionCostSummary extends OpenClawCostUsageTotals {
  sessionId?: string;
  firstActivity?: number;
  lastActivity?: number;
  durationMs?: number;
  activityDates?: string[];
  dailyBreakdown?: OpenClawSessionDailyUsage[];
  dailyMessageCounts?: OpenClawSessionDailyMessageCounts[];
  utcQuarterHourMessageCounts?: OpenClawSessionUtcQuarterHourMessageCounts[];
  utcQuarterHourTokenUsage?: OpenClawSessionUtcQuarterHourTokenUsage[];
  messageCounts?: OpenClawSessionMessageCounts;
  toolUsage?: OpenClawSessionToolUsage;
  modelUsage?: OpenClawSessionModelUsage[];
  latency?: OpenClawSessionLatencyStats;
  dailyLatency?: OpenClawSessionDailyLatency[];
  dailyModelUsage?: OpenClawSessionDailyModelUsage[];
}

export interface OpenClawSessionUsageEntry {
  key: string;
  label?: string;
  sessionId?: string;
  scope?: 'instance' | 'family';
  sessionFamilyKey?: string;
  currentSessionId?: string;
  includedSessionIds?: string[];
  historicalInstanceCount?: number;
  updatedAt?: number;
  agentId?: string;
  channel?: string;
  chatType?: string;
  origin?: UnknownRecord;
  modelOverride?: string;
  providerOverride?: string;
  modelProvider?: string;
  model?: string;
  usage: OpenClawSessionCostSummary | null;
  contextWeight?: UnknownRecord | null;
}

export interface OpenClawSessionsUsageAggregates {
  sessionCount?: number;
  longestSessionDurationMs?: number;
  messages: OpenClawSessionMessageCounts;
  tools: OpenClawSessionToolUsage;
  byModel: OpenClawSessionModelUsage[];
  byProvider: OpenClawSessionModelUsage[];
  byAgent: Array<{ agentId: string; totals: OpenClawCostUsageTotals }>;
  byChannel: Array<{ channel: string; totals: OpenClawCostUsageTotals }>;
  latency?: OpenClawSessionLatencyStats;
  dailyLatency?: OpenClawSessionDailyLatency[];
  modelDaily?: OpenClawSessionDailyModelUsage[];
  daily: Array<{
    date: string;
    tokens: number;
    cost: number;
    messages: number;
    toolCalls: number;
    errors: number;
  }>;
}

export interface OpenClawSessionsUsageResult {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: OpenClawSessionUsageEntry[];
  totals: OpenClawCostUsageTotals;
  aggregates: OpenClawSessionsUsageAggregates;
  cacheStatus?: OpenClawUsageCacheStatus;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function optionalFiniteNumber(value: unknown): boolean {
  return value === undefined || finiteNumber(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

const COST_TOTAL_KEYS = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'totalTokens',
  'totalCost',
  'inputCost',
  'outputCost',
  'cacheReadCost',
  'cacheWriteCost',
  'missingCostEntries',
] as const;

function costTotals(value: unknown): value is OpenClawCostUsageTotals {
  const source = record(value);
  if (!source || !COST_TOTAL_KEYS.every((key) => finiteNumber(source[key]))) return false;
  if (source.missingCostByModel === undefined) return true;
  const missing = record(source.missingCostByModel);
  if (!missing) return false;
  return Object.values(missing).every(nonNegativeInteger);
}

function cacheStatus(value: unknown): value is OpenClawUsageCacheStatus {
  const source = record(value);
  return Boolean(source)
    && ['fresh', 'partial', 'stale', 'refreshing'].includes(String(source?.status))
    && nonNegativeInteger(source?.cachedFiles)
    && nonNegativeInteger(source?.pendingFiles)
    && nonNegativeInteger(source?.staleFiles)
    && optionalFiniteNumber(source?.refreshedAt);
}

function messageCounts(value: unknown): value is OpenClawSessionMessageCounts {
  const source = record(value);
  return Boolean(source)
    && ['total', 'user', 'assistant', 'toolCalls', 'toolResults', 'errors']
      .every((key) => nonNegativeInteger(source?.[key]));
}

function toolUsage(value: unknown): value is OpenClawSessionToolUsage {
  const source = record(value);
  return Boolean(source)
    && nonNegativeInteger(source?.totalCalls)
    && nonNegativeInteger(source?.uniqueTools)
    && Array.isArray(source?.tools)
    && source.tools.every((entry) => {
      const tool = record(entry);
      return Boolean(tool) && typeof tool?.name === 'string' && nonNegativeInteger(tool?.count);
    });
}

function modelUsage(value: unknown): value is OpenClawSessionModelUsage {
  const source = record(value);
  return Boolean(source)
    && optionalString(source?.provider)
    && optionalString(source?.model)
    && nonNegativeInteger(source?.count)
    && costTotals(source?.totals);
}

function latency(value: unknown): value is OpenClawSessionLatencyStats {
  const source = record(value);
  return Boolean(source)
    && nonNegativeInteger(source?.count)
    && finiteNumber(source?.avgMs)
    && finiteNumber(source?.p95Ms)
    && finiteNumber(source?.minMs)
    && finiteNumber(source?.maxMs);
}

function dailyLatency(value: unknown): value is OpenClawSessionDailyLatency {
  const source = record(value);
  return Boolean(source) && typeof source?.date === 'string' && latency(source);
}

function dailyModelUsage(value: unknown): value is OpenClawSessionDailyModelUsage {
  const source = record(value);
  return Boolean(source)
    && typeof source?.date === 'string'
    && optionalString(source?.provider)
    && optionalString(source?.model)
    && finiteNumber(source?.tokens)
    && finiteNumber(source?.cost)
    && nonNegativeInteger(source?.count);
}

function dailyUsage(value: unknown): value is OpenClawSessionDailyUsage {
  const source = record(value);
  return Boolean(source)
    && typeof source?.date === 'string'
    && finiteNumber(source?.tokens)
    && finiteNumber(source?.cost);
}

function quarterIndex(value: unknown): value is number {
  return nonNegativeInteger(value) && value <= 95;
}

function dailyMessageCounts(value: unknown): value is OpenClawSessionDailyMessageCounts {
  const source = record(value);
  return Boolean(source) && typeof source?.date === 'string' && messageCounts(source);
}

function quarterHourMessageCounts(value: unknown): value is OpenClawSessionUtcQuarterHourMessageCounts {
  const source = record(value);
  return Boolean(source)
    && typeof source?.date === 'string'
    && quarterIndex(source?.quarterIndex)
    && messageCounts(source);
}

function quarterHourTokenUsage(value: unknown): value is OpenClawSessionUtcQuarterHourTokenUsage {
  const source = record(value);
  return Boolean(source)
    && typeof source?.date === 'string'
    && quarterIndex(source?.quarterIndex)
    && ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens', 'totalCost']
      .every((key) => finiteNumber(source?.[key]));
}

function sessionCostSummary(value: unknown): value is OpenClawSessionCostSummary {
  const source = record(value);
  if (!source || !costTotals(source)) return false;
  return optionalString(source.sessionId)
    && optionalFiniteNumber(source.firstActivity)
    && optionalFiniteNumber(source.lastActivity)
    && optionalFiniteNumber(source.durationMs)
    && (source.activityDates === undefined || stringArray(source.activityDates))
    && (source.dailyBreakdown === undefined || (Array.isArray(source.dailyBreakdown) && source.dailyBreakdown.every(dailyUsage)))
    && (source.dailyMessageCounts === undefined || (Array.isArray(source.dailyMessageCounts) && source.dailyMessageCounts.every(dailyMessageCounts)))
    && (source.utcQuarterHourMessageCounts === undefined || (Array.isArray(source.utcQuarterHourMessageCounts) && source.utcQuarterHourMessageCounts.every(quarterHourMessageCounts)))
    && (source.utcQuarterHourTokenUsage === undefined || (Array.isArray(source.utcQuarterHourTokenUsage) && source.utcQuarterHourTokenUsage.every(quarterHourTokenUsage)))
    && (source.messageCounts === undefined || messageCounts(source.messageCounts))
    && (source.toolUsage === undefined || toolUsage(source.toolUsage))
    && (source.modelUsage === undefined || (Array.isArray(source.modelUsage) && source.modelUsage.every(modelUsage)))
    && (source.latency === undefined || latency(source.latency))
    && (source.dailyLatency === undefined || (Array.isArray(source.dailyLatency) && source.dailyLatency.every(dailyLatency)))
    && (source.dailyModelUsage === undefined || (Array.isArray(source.dailyModelUsage) && source.dailyModelUsage.every(dailyModelUsage)));
}

function usageEntry(value: unknown): value is OpenClawSessionUsageEntry {
  const source = record(value);
  if (!source || typeof source.key !== 'string' || !source.key.trim()) return false;
  if (!optionalString(source.label)
    || !optionalString(source.sessionId)
    || !optionalString(source.sessionFamilyKey)
    || !optionalString(source.currentSessionId)
    || !optionalFiniteNumber(source.updatedAt)
    || !optionalString(source.agentId)
    || !optionalString(source.channel)
    || !optionalString(source.chatType)
    || !optionalString(source.modelOverride)
    || !optionalString(source.providerOverride)
    || !optionalString(source.modelProvider)
    || !optionalString(source.model)) return false;
  if (source.scope !== undefined && source.scope !== 'instance' && source.scope !== 'family') return false;
  if (source.includedSessionIds !== undefined && !stringArray(source.includedSessionIds)) return false;
  if (source.historicalInstanceCount !== undefined && !nonNegativeInteger(source.historicalInstanceCount)) return false;
  if (source.origin !== undefined && !record(source.origin)) return false;
  if (source.contextWeight !== undefined && source.contextWeight !== null && !record(source.contextWeight)) return false;
  return source.usage === null || sessionCostSummary(source.usage);
}

function aggregateDaily(value: unknown): boolean {
  const source = record(value);
  return Boolean(source)
    && typeof source?.date === 'string'
    && ['tokens', 'cost', 'messages', 'toolCalls', 'errors'].every((key) => finiteNumber(source?.[key]));
}

function aggregates(value: unknown): value is OpenClawSessionsUsageAggregates {
  const source = record(value);
  if (!source) return false;
  if (source.sessionCount !== undefined && !nonNegativeInteger(source.sessionCount)) return false;
  if (source.longestSessionDurationMs !== undefined && !finiteNumber(source.longestSessionDurationMs)) return false;
  if (!messageCounts(source.messages) || !toolUsage(source.tools)) return false;
  if (!Array.isArray(source.byModel) || !source.byModel.every(modelUsage)) return false;
  if (!Array.isArray(source.byProvider) || !source.byProvider.every(modelUsage)) return false;
  if (!Array.isArray(source.byAgent) || !source.byAgent.every((entry) => {
    const item = record(entry);
    return Boolean(item) && typeof item?.agentId === 'string' && costTotals(item?.totals);
  })) return false;
  if (!Array.isArray(source.byChannel) || !source.byChannel.every((entry) => {
    const item = record(entry);
    return Boolean(item) && typeof item?.channel === 'string' && costTotals(item?.totals);
  })) return false;
  if (source.latency !== undefined && !latency(source.latency)) return false;
  if (source.dailyLatency !== undefined && (!Array.isArray(source.dailyLatency) || !source.dailyLatency.every(dailyLatency))) return false;
  if (source.modelDaily !== undefined && (!Array.isArray(source.modelDaily) || !source.modelDaily.every(dailyModelUsage))) return false;
  return Array.isArray(source.daily) && source.daily.every(aggregateDaily);
}

export function parseOpenClawCostUsageSummary(value: unknown): OpenClawCostUsageSummary | null {
  const source = record(value);
  if (!source
    || !finiteNumber(source.updatedAt)
    || !nonNegativeInteger(source.days)
    || !Array.isArray(source.daily)
    || !source.daily.every((entry) => {
      const day = record(entry);
      return Boolean(day) && typeof day?.date === 'string' && costTotals(day);
    })
    || !costTotals(source.totals)
    || (source.cacheStatus !== undefined && !cacheStatus(source.cacheStatus))) return null;
  return value as OpenClawCostUsageSummary;
}

export function parseOpenClawSessionsUsage(value: unknown): OpenClawSessionsUsageResult | null {
  const source = record(value);
  if (!source
    || !finiteNumber(source.updatedAt)
    || typeof source.startDate !== 'string'
    || typeof source.endDate !== 'string'
    || !Array.isArray(source.sessions)
    || !source.sessions.every(usageEntry)
    || !costTotals(source.totals)
    || !aggregates(source.aggregates)
    || (source.cacheStatus !== undefined && !cacheStatus(source.cacheStatus))) return null;
  return value as OpenClawSessionsUsageResult;
}
