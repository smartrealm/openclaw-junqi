export interface SystemMetricsPayload {
  cpu: number;
  cpu_count: number;
  mem_used: number;
  mem_total: number;
  disk_used: number;
  disk_total: number;
  net_up_speed: number;
  net_down_speed: number;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
  platform: string;
  platform_version: string;
  arch: string;
}

export interface TauriPlatformInfo {
  os: string;
  arch: string;
}

export interface StorageRuntimePaths {
  stateDir: string;
  workspaceDir: string;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Invalid native ${field} value`);
  }
  return value;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseTauriPlatformInfo(value: unknown): TauriPlatformInfo {
  const source = objectRecord(value);
  if (!source) throw new Error('Invalid native get_platform_info response');
  return {
    os: nonEmptyString(source.os, 'platform os'),
    arch: nonEmptyString(source.arch, 'platform arch'),
  };
}

export function parseStorageRuntimePaths(value: unknown): StorageRuntimePaths | null {
  const source = objectRecord(value);
  if (!source) return null;
  const stateDir = source.stateDir;
  const workspaceDir = source.workspaceDir;
  if (typeof stateDir !== 'string' || !stateDir.trim()) return null;
  if (typeof workspaceDir !== 'string' || !workspaceDir.trim()) return null;
  return { stateDir, workspaceDir };
}

export function parseSystemMetricsPayload(value: unknown): SystemMetricsPayload | null {
  const source = objectRecord(value);
  if (!source) return null;
  const cpu = finiteNonNegativeNumber(source.cpu);
  const cpuCount = finiteNonNegativeNumber(source.cpu_count);
  const memUsed = finiteNonNegativeNumber(source.mem_used);
  const memTotal = finiteNonNegativeNumber(source.mem_total);
  const diskUsed = finiteNonNegativeNumber(source.disk_used);
  const diskTotal = finiteNonNegativeNumber(source.disk_total);
  const netUpSpeed = finiteNonNegativeNumber(source.net_up_speed);
  const netDownSpeed = finiteNonNegativeNumber(source.net_down_speed);
  const uptime = finiteNonNegativeNumber(source.uptime);
  const load1 = finiteNonNegativeNumber(source.load1);
  const load5 = finiteNonNegativeNumber(source.load5);
  const load15 = finiteNonNegativeNumber(source.load15);
  if (cpu === null || cpuCount === null || memUsed === null || memTotal === null
    || diskUsed === null || diskTotal === null || netUpSpeed === null || netDownSpeed === null
    || uptime === null || load1 === null || load5 === null || load15 === null) return null;
  if (typeof source.platform !== 'string' || !source.platform.trim()) return null;
  if (typeof source.platform_version !== 'string' || !source.platform_version.trim()) return null;
  if (typeof source.arch !== 'string' || !source.arch.trim()) return null;
  return {
    cpu,
    cpu_count: cpuCount,
    mem_used: memUsed,
    mem_total: memTotal,
    disk_used: diskUsed,
    disk_total: diskTotal,
    net_up_speed: netUpSpeed,
    net_down_speed: netDownSpeed,
    uptime,
    load1,
    load5,
    load15,
    platform: source.platform,
    platform_version: source.platform_version,
    arch: source.arch,
  };
}
