/**
 * Decides what a config save actually requires.
 *
 * Every save used to restart the Gateway, which drops all in-flight sessions
 * and tool runs. OpenClaw already answers this per path: `config.schema.lookup`
 * returns `reloadKind` as `restart`, `hot` or `none`, mirroring the gateway's
 * own reload planner (`docs/gateway/protocol.md`). Sampling the installed
 * 2026.7.1-2 gateway shows most edits do not need a restart at all:
 *
 *   gateway.port / gateway.auth / gateway.bind      restart
 *   channels.telegram.botToken                      restart
 *   agents.defaults.model / models.providers        hot
 *   agents.defaults.workspace / session.dmScope     none
 *   tools.experimental.planTool                     none
 *   skills.install.nodeManager                      none
 *
 * `reloadKind` is not present in the static `config schema` output, so it can
 * only be obtained from the RPC - it cannot be precomputed or bundled.
 */

export type ConfigReloadKind = 'none' | 'hot' | 'restart';

export interface ConfigReloadPlan {
  kind: ConfigReloadKind;
  /** Paths that forced the strongest requirement, for user-facing explanation. */
  decidingPaths: string[];
  /** Set when the plan degraded to `restart` because the semantics were unknown. */
  fallbackReason?: string;
}

const RELOAD_STRENGTH: Record<ConfigReloadKind, number> = { none: 0, hot: 1, restart: 2 };

function isReloadKind(value: unknown): value is ConfigReloadKind {
  return value === 'none' || value === 'hot' || value === 'restart';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Dotted paths whose values differ. Arrays are compared whole: OpenClaw's
 * reload planner is keyed on config paths, not on array element identity, so
 * reporting `channels.list.0` would ask about a path the planner does not know.
 */
export function diffConfigPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return [];
  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);
  if (!beforeIsObject && !afterIsObject) {
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
    return prefix ? [prefix] : [];
  }
  // A whole subtree added or removed still has to report its leaves: the reload
  // planner answers for concrete paths, and asking about the parent alone can
  // miss a leaf that demands a restart.
  const left = beforeIsObject ? before : {};
  const right = afterIsObject ? after : {};
  const paths: string[] = [];
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.push(...diffConfigPaths(left[key], right[key], path));
  }
  return paths;
}

export type ReloadKindLookup = (path: string) => Promise<unknown>;

/**
 * Aggregates the strongest requirement across the changed paths.
 *
 * Fails closed: an unavailable lookup, a rejected path, or a `reloadKind` the
 * client does not recognise all degrade to `restart`. Not knowing the reload
 * semantics must never be read as permission to skip the restart.
 */
export async function planConfigReload(
  changedPaths: readonly string[],
  lookup: ReloadKindLookup,
): Promise<ConfigReloadPlan> {
  if (changedPaths.length === 0) return { kind: 'none', decidingPaths: [] };

  let kind: ConfigReloadKind = 'none';
  let decidingPaths: string[] = [];
  let fallbackReason: string | undefined;

  for (const path of changedPaths) {
    let resolved: ConfigReloadKind = 'restart';
    try {
      const payload = await lookup(path);
      const raw = isPlainObject(payload) ? payload.reloadKind : undefined;
      if (isReloadKind(raw)) {
        resolved = raw;
      } else {
        fallbackReason ??= `no reloadKind for ${path}`;
      }
    } catch (error) {
      resolved = 'restart';
      fallbackReason ??= `lookup failed for ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    if (RELOAD_STRENGTH[resolved] > RELOAD_STRENGTH[kind]) {
      kind = resolved;
      decidingPaths = [path];
    } else if (resolved === kind && kind !== 'none') {
      decidingPaths.push(path);
    }
  }

  return { kind, decidingPaths, ...(fallbackReason ? { fallbackReason } : {}) };
}
