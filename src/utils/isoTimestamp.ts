/** Converts a numeric protocol timestamp only when JavaScript can represent its date. */
export function toSafeIsoTimestamp(timestamp: number): string | null {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
