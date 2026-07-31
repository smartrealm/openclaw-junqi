import type { ChannelConfig, GatewayRuntimeConfig } from '@/types/openclawConfig';

export const CONFIG_REVISION_CONFLICT_PREFIX = 'CONFIG_REVISION_CONFLICT';

// OpenClaw owns these channel namespace entries. They are configuration
// metadata, not delivery channels that can be enabled, bound, or removed.
const CHANNEL_CONFIGURATION_METADATA_KEYS = new Set(['defaults', 'modelByChannel']);

type ChannelRouteBinding = NonNullable<GatewayRuntimeConfig['bindings']>[number];

export interface MergedChannelConfigPartitions {
  channels: GatewayRuntimeConfig['channels'];
  bindings: GatewayRuntimeConfig['bindings'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => valuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => hasOwn(right, key) && valuesEqual(left[key], right[key]));
}

function mergeConfigValue(base: unknown, next: unknown, latest: unknown): unknown {
  if (valuesEqual(base, next)) return latest;
  if (valuesEqual(latest, base)) return next;
  if (isRecord(base) && isRecord(next) && isRecord(latest)) {
    return mergeConfigRecords(base, next, latest);
  }
  // A concurrent edit to the same scalar or array wins over a stale UI write.
  return latest;
}

function mergeConfigRecords(
  base: Record<string, unknown>,
  next: Record<string, unknown>,
  latest: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...latest };
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);

  for (const key of keys) {
    const hasBase = hasOwn(base, key);
    const hasNext = hasOwn(next, key);
    const hasLatest = hasOwn(latest, key);

    if (!hasBase && hasNext) {
      if (!hasLatest) Reflect.set(merged, key, next[key]);
      continue;
    }
    if (hasBase && !hasNext) {
      if (hasLatest && valuesEqual(latest[key], base[key])) {
        Reflect.deleteProperty(merged, key);
      }
      continue;
    }
    if (!hasBase || !hasNext || valuesEqual(base[key], next[key])) continue;

    // A concurrent deletion is intentionally preserved. Recreating an object
    // after another writer removed it is a more surprising loss than asking
    // the stale editor to retry.
    if (!hasLatest) continue;
    Reflect.set(merged, key, mergeConfigValue(base[key], next[key], latest[key]));
  }

  return merged;
}

function mergeChannels(
  base: Record<string, ChannelConfig>,
  next: Record<string, ChannelConfig>,
  latest: Record<string, ChannelConfig>,
): Record<string, ChannelConfig> {
  const merged = { ...latest };
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);

  for (const key of keys) {
    const hasBase = Object.prototype.hasOwnProperty.call(base, key);
    const hasNext = Object.prototype.hasOwnProperty.call(next, key);
    const hasLatest = Object.prototype.hasOwnProperty.call(latest, key);

    if (!hasBase && hasNext) {
      if (!hasLatest) Reflect.set(merged, key, next[key]);
      continue;
    }
    if (hasBase && !hasNext) {
      if (hasLatest && valuesEqual(latest[key], base[key])) {
        Reflect.deleteProperty(merged, key);
      }
      continue;
    }
    if (!hasBase || !hasNext || valuesEqual(base[key], next[key])) continue;
    if (!hasLatest) continue;
    Reflect.set(merged, key, mergeConfigValue(base[key], next[key], latest[key]));
  }

  return merged;
}

function stableValueKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(',')}}`;
  }
  return String(value);
}

function bindingRouteKey(binding: ChannelRouteBinding): string {
  return `${binding.type ?? 'route'}:${stableValueKey(binding.match)}`;
}

function bindingsByRoute(bindings: ChannelRouteBinding[]): Map<string, ChannelRouteBinding[]> {
  const grouped = new Map<string, ChannelRouteBinding[]>();
  for (const binding of bindings) {
    const key = bindingRouteKey(binding);
    const entries = grouped.get(key) ?? [];
    entries.push(binding);
    grouped.set(key, entries);
  }
  return grouped;
}

function replaceBindingsForRoute(
  bindings: ChannelRouteBinding[],
  routeKey: string,
  replacements: ChannelRouteBinding[],
): ChannelRouteBinding[] {
  let inserted = false;
  const result: ChannelRouteBinding[] = [];
  for (const binding of bindings) {
    if (bindingRouteKey(binding) !== routeKey) {
      result.push(binding);
      continue;
    }
    if (!inserted) {
      result.push(...replacements);
      inserted = true;
    }
  }
  if (!inserted) result.push(...replacements);
  return result;
}

function mergeBindings(
  base: ChannelRouteBinding[],
  next: ChannelRouteBinding[],
  latest: ChannelRouteBinding[],
): ChannelRouteBinding[] {
  const baseByRoute = bindingsByRoute(base);
  const nextByRoute = bindingsByRoute(next);
  const latestByRoute = bindingsByRoute(latest);
  const routeKeys = new Set([...baseByRoute.keys(), ...nextByRoute.keys()]);
  let merged = [...latest];

  for (const routeKey of routeKeys) {
    const baseEntries = baseByRoute.get(routeKey) ?? [];
    const nextEntries = nextByRoute.get(routeKey) ?? [];
    if (valuesEqual(baseEntries, nextEntries)) continue;

    const latestEntries = latestByRoute.get(routeKey) ?? [];
    if (!valuesEqual(latestEntries, baseEntries)) continue;
    merged = replaceBindingsForRoute(merged, routeKey, nextEntries);
  }

  return merged;
}

export function isChannelConfigurationMetadataKey(channelId: string): boolean {
  return CHANNEL_CONFIGURATION_METADATA_KEYS.has(channelId);
}

export function isConfigRevisionConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(CONFIG_REVISION_CONFLICT_PREFIX);
}

export function mergeChannelConfigPartitions(
  base: GatewayRuntimeConfig,
  next: GatewayRuntimeConfig,
  latest: GatewayRuntimeConfig,
): MergedChannelConfigPartitions {
  return {
    channels: mergeChannels(base.channels ?? {}, next.channels ?? {}, latest.channels ?? {}),
    bindings: mergeBindings(base.bindings ?? [], next.bindings ?? [], latest.bindings ?? []),
  };
}
