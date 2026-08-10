// ═══════════════════════════════════════════════════════════
// FullAnalytics — OpenClaw usage contract aliases
// 解析和校验集中在 gateway 服务层，页面只消费已验证的官方结构。
// ═══════════════════════════════════════════════════════════

import type {
  OpenClawCostUsageDailyEntry,
  OpenClawCostUsageSummary,
  OpenClawCostUsageTotals,
  OpenClawSessionModelUsage,
  OpenClawSessionsUsageAggregates,
  OpenClawSessionsUsageResult,
} from '@/services/gateway/OpenClawUsageClient';

export type CostTotals = OpenClawCostUsageTotals;
export type DailyEntry = OpenClawCostUsageDailyEntry;
export type CostSummary = OpenClawCostUsageSummary;
export type ByModelEntry = OpenClawSessionModelUsage;
export type ByAgentEntry = OpenClawSessionsUsageAggregates['byAgent'][number];
export type UsageAggregates = OpenClawSessionsUsageAggregates;
export type SessionsUsageResponse = OpenClawSessionsUsageResult;

/** Quick-select preset identifiers for the Date Range Picker */
export type PresetId =
  | 'today'
  | '7d'
  | 'thisMonth'
  | '30d'
  | '90d'
  | 'all'
  | 'custom';

export interface DateRangePickerProps {
  activePreset: PresetId;
  savedPreset: PresetId;
  startDate: string;
  endDate: string;
  onPresetSelect: (id: PresetId, start: string, end: string) => void;
  onApply: (customStart?: string, customEnd?: string) => void;
}
