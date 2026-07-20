export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function previousLocalDateKey(date: Date): string {
  const previous = new Date(date);
  previous.setDate(previous.getDate() - 1);
  return localDateKey(previous);
}

export function costChangePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export function percentageOf(used: number, maximum: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(100, (used / maximum) * 100));
}

export function budgetProgress(spend: number, limit: number): number | null {
  if (!Number.isFinite(limit) || limit <= 0) return null;
  return percentageOf(spend, limit);
}
