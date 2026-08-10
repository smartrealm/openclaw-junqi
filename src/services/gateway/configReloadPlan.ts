/**
 * 根据 OpenClaw `config.schema.lookup` 返回的路径级 `reloadKind` 决定保存后的动作。
 * 该字段属于运行时 Schema 结果，客户端不得按版本或路径预置重载规则。
 */

export type ConfigReloadKind = 'none' | 'hot' | 'restart';
export type ConfigReloadFallbackReason = 'reload-kind-missing' | 'lookup-failed';

export interface ConfigReloadPlan {
  kind: ConfigReloadKind;
  /** 触发最强重载要求的配置路径。 */
  decidingPaths: string[];
  /** 无法取得权威重载语义时使用的稳定失败分类，不携带原始异常。 */
  fallbackReason?: ConfigReloadFallbackReason;
}

const RELOAD_STRENGTH: Record<ConfigReloadKind, number> = { none: 0, hot: 1, restart: 2 };

function isReloadKind(value: unknown): value is ConfigReloadKind {
  return value === 'none' || value === 'hot' || value === 'restart';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 返回值发生变化的点路径；数组按整体比较，避免生成 Gateway 不认识的元素索引路径。 */
export function diffConfigPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (Object.is(before, after)) return [];
  const beforeIsObject = isPlainObject(before);
  const afterIsObject = isPlainObject(after);
  if (!beforeIsObject && !afterIsObject) {
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return [];
    return prefix ? [prefix] : [];
  }
  // 整棵子树新增或删除时仍展开到叶子，避免父路径掩盖需要重启的具体配置项。
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

/** 聚合所有变更路径的最强要求；查询失败或未知结果一律失败关闭为重启。 */
export async function planConfigReload(
  changedPaths: readonly string[],
  lookup: ReloadKindLookup,
): Promise<ConfigReloadPlan> {
  if (changedPaths.length === 0) return { kind: 'none', decidingPaths: [] };

  let kind: ConfigReloadKind = 'none';
  let decidingPaths: string[] = [];
  let fallbackReason: ConfigReloadFallbackReason | undefined;

  for (const path of changedPaths) {
    let resolved: ConfigReloadKind = 'restart';
    try {
      const payload = await lookup(path);
      const raw = isPlainObject(payload) ? payload.reloadKind : undefined;
      if (isReloadKind(raw)) {
        resolved = raw;
      } else {
        fallbackReason ??= 'reload-kind-missing';
      }
    } catch {
      resolved = 'restart';
      fallbackReason ??= 'lookup-failed';
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
