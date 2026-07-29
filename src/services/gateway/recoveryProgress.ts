// ═══════════════════════════════════════════════════════════
// Gateway recovery progress — turns lifecycle output into a stable,
// localizable UI contract. Rust keeps emitting diagnostic lines while the
// renderer receives bounded phases instead of raw command output.
// ═══════════════════════════════════════════════════════════

export type GatewayRecoveryStatus = 'running' | 'completed' | 'failed';

export interface GatewayRecoveryProgress {
  step: 'gateway';
  message: string;
  progress: number;
  key: string;
  status: GatewayRecoveryStatus;
  params?: Record<string, unknown>;
}

type GatewayRecoveryProgressInput = Omit<GatewayRecoveryProgress, 'step'>;

function createGatewayProgress(
  input: GatewayRecoveryProgressInput,
): GatewayRecoveryProgress {
  return { step: 'gateway', ...input };
}

export const gatewayProgress = {
  waitingForMigration(seconds: number): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Waiting for OpenClaw startup migration to finish...',
      progress: 0.36,
      key: 'gateway.progress.waitingForMigrationLock',
      params: { seconds },
      status: 'running',
    });
  },
  restartUnavailable(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway restart is unavailable in this runtime.',
      progress: 1,
      key: 'gateway.progress.restartUnavailable',
      status: 'failed',
    });
  },
  restartStarting(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Restarting OpenClaw Gateway...',
      progress: 0.15,
      key: 'gateway.progress.restart',
      status: 'running',
    });
  },
  restartDone(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway service restarted, reconnecting...',
      progress: 0.94,
      key: 'gateway.progress.restartDone',
      status: 'running',
    });
  },
  restartFailed(error: string): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: `Restart failed: ${error}`,
      progress: 1,
      key: 'gateway.progress.restartFailed',
      params: { error },
      status: 'failed',
    });
  },
  starting(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Starting OpenClaw Gateway...',
      progress: 0.20,
      key: 'gateway.progress.starting',
      status: 'running',
    });
  },
  runtimeReady(mode: unknown): GatewayRecoveryProgress {
    const runtimeMode = typeof mode === 'string' && mode.trim() ? mode.trim() : 'native';
    return createGatewayProgress({
      message: `Gateway runtime is ready (${runtimeMode}); establishing authenticated connection...`,
      progress: 0.75,
      key: 'gateway.progress.runtimeReady',
      params: { mode: runtimeMode },
      status: 'running',
    });
  },
  processDetected(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway process detected; verifying configuration and authentication...',
      progress: 0.72,
      key: 'gateway.progress.processDetected',
      status: 'running',
    });
  },
  ensureUnhealthy(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway did not become ready, attempting restart...',
      progress: 0.45,
      key: 'gateway.progress.ensureUnhealthy',
      status: 'running',
    });
  },
  ensureFailed(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway recovery failed, attempting restart...',
      progress: 0.45,
      key: 'gateway.progress.ensureFailed',
      status: 'running',
    });
  },
  reconnecting(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Reconnecting to OpenClaw Gateway...',
      progress: 0.10,
      key: 'gateway.progress.reconnect',
      status: 'running',
    });
  },
  detecting(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Detecting, connecting, and syncing runtime state...',
      progress: 0.45,
      key: 'gateway.progress.detectConnectSync',
      status: 'running',
    });
  },
  connectionFailed(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway recovery finished, but the authenticated connection could not be established.',
      progress: 1,
      key: 'gateway.progress.connectionFailed',
      status: 'failed',
    });
  },
  recoveryComplete(): GatewayRecoveryProgress {
    return createGatewayProgress({
      message: 'Gateway recovered and authenticated.',
      progress: 1,
      key: 'gateway.progress.recoveryComplete',
      status: 'completed',
    });
  },
} as const;

interface RestartProgressRule {
  matches: (line: string) => boolean;
  progress: number;
  key: string;
}

const RESTART_PROGRESS_RULES: readonly RestartProgressRule[] = [
  {
    matches: (line) => line.includes('lifecycle operation in progress'),
    progress: 0.12,
    key: 'gateway.progress.waitingForLifecycle',
  },
  {
    matches: (line) => line.includes('restarting openclaw gateway service'),
    progress: 0.18,
    key: 'gateway.progress.restart',
  },
  {
    matches: (line) => line.includes('stopping desktop-managed gateway process'),
    progress: 0.30,
    key: 'gateway.progress.stoppingManaged',
  },
  {
    matches: (line) => line.includes('restart unavailable') || line.includes('restart exited with'),
    progress: 0.42,
    key: 'gateway.progress.managedFallback',
  },
  {
    matches: (line) => line.includes('starting desktop-managed gateway'),
    progress: 0.52,
    key: 'gateway.progress.startingManaged',
  },
  {
    matches: (line) => line.includes('restart command completed'),
    progress: 0.66,
    key: 'gateway.progress.restartDone',
  },
  {
    matches: (line) => line.includes('waiting for gateway to become reachable')
      || line.includes('waiting for desktop-managed gateway to become reachable'),
    progress: 0.80,
    key: 'gateway.progress.healthCheck',
  },
  {
    matches: (line) => line.includes('gateway health check passed')
      || line.includes('desktop-managed gateway health check passed'),
    progress: 0.92,
    key: 'gateway.progress.gatewayReady',
  },
];

/**
 * Map one Rust lifecycle line to user-facing recovery progress.
 *
 * The command output remains available in the log panel. Keeping it out of the
 * primary status copy avoids exposing unstable CLI wording or accidental data
 * from a third-party launcher in the main UI.
 */
export function gatewayRestartProgressFromLog(line: string): GatewayRecoveryProgress {
  const normalized = line.trim().toLowerCase();
  const rule = RESTART_PROGRESS_RULES.find((candidate) => candidate.matches(normalized));

  return createGatewayProgress({
    message: 'Restarting OpenClaw Gateway...',
    progress: rule?.progress ?? 0.50,
    key: rule?.key ?? 'gateway.progress.restartWorking',
    status: 'running',
  });
}
