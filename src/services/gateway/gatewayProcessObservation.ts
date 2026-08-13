import {
  ensureGatewayRunning,
  getGatewayLogs,
  getGatewayProcessStatus,
  probeSelectedGateway,
  restartGateway,
  stopGateway,
  type LogEntry,
} from '@/api/tauri-commands';
import { formatGatewayLogs } from './gatewayLogFormatting';
import { gatewayRestartSingleFlight } from './SingleFlight';
import type { GatewayEnsureResult, GatewayRestartResult } from './GatewayLifecycleCoordinator';

export interface GatewayProcessObservation {
  running: boolean;
  processAlive: boolean;
  ready: boolean;
  error: string | null;
}

export interface GatewayProcessRuntimeStatus extends GatewayProcessObservation {
  retrying: boolean;
  logs: { stdout: string; stderr: string };
}

/**
 * 分别读取所选运行时的进程状态与认证端点状态。
 * 进程存活时 Gateway 仍可能处于预热阶段。
 */
export async function observeSelectedGatewayProcess(): Promise<GatewayProcessObservation> {
  try {
    const status = await getGatewayProcessStatus();
    const processAlive = Boolean(status.running || status.pid);
    const ready = processAlive
      ? await probeSelectedGateway(status.port)
      : false;
    return { running: processAlive, processAlive, ready, error: null };
  } catch (error) {
    return {
      running: false,
      processAlive: false,
      ready: false,
      error: String(error),
    };
  }
}

/** 日志只用于进程诊断，不能决定所选运行时状态。 */
export async function loadGatewayProcessLogs(limit: number): Promise<LogEntry[]> {
  try {
    return await getGatewayLogs(limit);
  } catch {
    return [];
  }
}

export async function readGatewayProcessRuntimeStatus(): Promise<GatewayProcessRuntimeStatus> {
  const observation = await observeSelectedGatewayProcess();
  return {
    ...observation,
    retrying: false,
    logs: formatGatewayLogs(await loadGatewayProcessLogs(80)),
  };
}

/** 串行轮询避免认证探测尚未结束时提交过期状态。 */
export function subscribeGatewayProcessRuntime(
  listener: (status: GatewayProcessRuntimeStatus) => void,
  intervalMs = 2_000,
): () => void {
  let stopped = false;
  let inFlight = false;
  let queued = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = () => {
    if (stopped || inFlight) { queued = true; return; }
    inFlight = true;
    void readGatewayProcessRuntimeStatus().then((status) => {
      if (!stopped) listener(status);
    }).finally(() => {
      inFlight = false;
      if (stopped) return;
      const delay = queued ? 0 : intervalMs;
      queued = false;
      timer = setTimeout(poll, delay);
    });
  };
  poll();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

export async function ensureSelectedGatewayRuntime(): Promise<GatewayEnsureResult> {
  try {
    return await ensureGatewayRunning();
  } catch (error) {
    return { healthy: false, error: String(error) };
  }
}

export function restartSelectedGatewayRuntime(): Promise<GatewayRestartResult> {
  return gatewayRestartSingleFlight.run(async () => {
    try {
      await restartGateway();
      return { success: true, method: 'gateway-restart' };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
}

export async function stopSelectedGatewayRuntime(): Promise<GatewayRestartResult> {
  try {
    await stopGateway();
    return { success: true, method: 'gateway-stop' };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
