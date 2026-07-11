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
}

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

  return {
    step: 'gateway',
    message: 'Restarting OpenClaw Gateway...',
    progress: rule?.progress ?? 0.50,
    key: rule?.key ?? 'gateway.progress.restartWorking',
    status: 'running',
  };
}
