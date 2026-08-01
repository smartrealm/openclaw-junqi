import {
  createGatewayMigrationRetryCoordinator,
  gatewayMigrationRetryDelayMs,
  type GatewayMigrationRetryCoordinator,
} from './openclawRepair';
import type { GatewayRecoveryStatus } from './recoveryProgress';

export type GatewayLifecycleAction = 'reconnect' | 'recover' | 'restart';

export interface GatewayLifecycleRequest {
  action: GatewayLifecycleAction;
  source: string;
  diagnostic?: string;
}

export interface GatewayEnsureResult {
  healthy: boolean;
  mode?: string;
  error?: string | null;
  superseded?: boolean;
}

export interface GatewayRestartResult {
  success: boolean;
  error?: string;
  superseded?: boolean;
  method?: string;
  changedPaths?: string[];
  requiresAppRestart?: boolean;
}

export interface GatewayLifecycleResult extends GatewayRestartResult {
  action: GatewayLifecycleAction;
  source: string;
  healthy?: boolean;
  mode?: string;
}

export interface GatewayLifecycleProgress {
  step: 'gateway';
  message: string;
  progress: number;
  key: string;
  params?: Record<string, unknown>;
  status: GatewayRecoveryStatus;
  action: GatewayLifecycleAction;
  source: string;
}

interface GatewayLifecycleManager {
  ensureRunning: () => Promise<GatewayEnsureResult>;
  restart: () => Promise<GatewayRestartResult>;
  reconnect: () => void;
}

type ProgressListener = (progress: GatewayLifecycleProgress) => void;

type CoordinatorDependencies = {
  manager: GatewayLifecycleManager;
  migrationRetry: GatewayMigrationRetryCoordinator;
  /**
   * Re-attests that the restarted endpoint is the Gateway belonging to the
   * selected runtime. A healthy port alone cannot tell it apart from another
   * local Gateway that happens to bind the same port, so a restart that skips
   * this check can report success while the client talks to a foreign process.
   * Omitted only in tests that do not exercise the restart post-condition.
   */
  verifySelectedIdentity?: () => Promise<boolean>;
};

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string' && value) return value;
  return fallback;
}

const ACTION_STRENGTH: Record<GatewayLifecycleAction, number> = {
  reconnect: 0,
  recover: 1,
  restart: 2,
};

export class GatewayLifecycleCoordinator {
  private active: Promise<GatewayLifecycleResult> | null = null;
  private activeAction: GatewayLifecycleAction | null = null;
  private pendingUpgrade: GatewayLifecycleRequest | null = null;
  private pendingUpgradeResult: Promise<GatewayLifecycleResult> | null = null;
  private listeners = new Set<ProgressListener>();

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  get running(): boolean {
    return this.active !== null;
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reconnect(source: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'reconnect', source });
  }

  recover(source: string, diagnostic?: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'recover', source, diagnostic });
  }

  restart(source: string, diagnostic?: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'restart', source, diagnostic });
  }

  request(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    if (this.active) {
      if (ACTION_STRENGTH[request.action] <= ACTION_STRENGTH[this.activeAction ?? 'reconnect']) {
        return this.active;
      }
      if (!this.pendingUpgrade || ACTION_STRENGTH[request.action] > ACTION_STRENGTH[this.pendingUpgrade.action]) {
        this.pendingUpgrade = request;
      }
      return this.schedulePendingUpgrade();
    }

    const operation = this.executeSafely(request);
    this.active = operation;
    this.activeAction = request.action;
    void operation.then(() => {
      if (this.active === operation) {
        this.active = null;
        this.activeAction = null;
      }
    });
    return operation;
  }

  cancelMigrationWait(): boolean {
    return this.dependencies.migrationRetry.cancel();
  }

  private schedulePendingUpgrade(): Promise<GatewayLifecycleResult> {
    if (this.pendingUpgradeResult) return this.pendingUpgradeResult;

    const active = this.active;
    if (!active) throw new Error('Cannot schedule a Gateway lifecycle upgrade without an active operation.');
    this.pendingUpgradeResult = active.then(() => {
      const upgrade = this.pendingUpgrade;
      this.pendingUpgrade = null;
      this.pendingUpgradeResult = null;
      if (!upgrade) {
        throw new Error('Gateway lifecycle upgrade was cleared before it could run.');
      }
      return this.request(upgrade);
    });
    return this.pendingUpgradeResult;
  }

  private async executeSafely(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    try {
      return await this.execute(request);
    } catch (error) {
      const message = errorMessage(error, 'Gateway lifecycle operation failed');
      this.emit(
        request,
        `Gateway operation failed: ${message}`,
        1,
        'gateway.progress.restartFailed',
        { error: message },
        'failed',
      );
      return { success: false, error: message, action: request.action, source: request.source };
    }
  }

  private async execute(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    if (request.action === 'reconnect') {
      this.emit(request, 'Reconnecting to OpenClaw Gateway…', 0.1, 'gateway.progress.reconnect');
      this.dependencies.manager.reconnect();
      this.emit(request, 'Gateway reconnect requested.', 1, 'gateway.progress.reconnect', undefined, 'completed');
      return { success: true, action: request.action, source: request.source };
    }

    if (request.action === 'recover') {
      this.emit(request, 'Detecting, connecting, and syncing runtime state…', 0.08, 'gateway.progress.detectConnectSync');
      try {
        const ensured = await this.dependencies.manager.ensureRunning();
        if (ensured.superseded) {
          this.emitSuperseded(request);
          return { success: false, superseded: true, action: request.action, source: request.source };
        }
        if (ensured.healthy) {
          this.dependencies.migrationRetry.cancel();
          this.emit(
            request,
            `Gateway healthy (${ensured.mode ?? 'native'}), reconnecting…`,
            1,
            'gateway.progress.gatewayHealthy',
            undefined,
            'completed',
          );
          return {
            success: true,
            healthy: true,
            mode: ensured.mode,
            action: request.action,
            source: request.source,
          };
        }
        return this.executeRestart(request, ensured.error ?? request.diagnostic);
      } catch (error) {
        return this.executeRestart(request, errorMessage(error, request.diagnostic ?? 'Gateway recovery failed'));
      }
    }

    return this.executeRestart(request, request.diagnostic);
  }

  private async executeRestart(
    request: GatewayLifecycleRequest,
    diagnostic?: string,
  ): Promise<GatewayLifecycleResult> {
    let currentDiagnostic = diagnostic;
    while (true) {
      const delayMs = gatewayMigrationRetryDelayMs(currentDiagnostic ?? '');
      if (delayMs > 0) {
        const seconds = Math.max(1, Math.ceil(delayMs / 1_000));
        this.emit(
          request,
          'Waiting for OpenClaw startup migration to finish…',
          0.08,
          'gateway.progress.waitingForMigrationLock',
          { seconds },
        );
        if (!(await this.dependencies.migrationRetry.wait(delayMs))) {
          const message = 'Gateway restart cancelled while waiting for startup migration.';
          this.emit(request, message, 1, 'gateway.progress.restartFailed', { error: message }, 'failed');
          return { success: false, error: message, action: request.action, source: request.source };
        }
      }

      this.emit(request, 'Restarting OpenClaw Gateway…', 0.1, 'gateway.progress.restart');
      let restarted: GatewayRestartResult;
      try {
        restarted = await this.dependencies.manager.restart();
      } catch (error) {
        restarted = { success: false, error: errorMessage(error, 'Gateway restart failed') };
      }
      if (restarted.superseded) {
        this.emitSuperseded(request);
        return { success: false, superseded: true, action: request.action, source: request.source };
      }
      if (restarted.success) {
        const identityFailure = await this.verifyRestartedIdentity(request);
        if (identityFailure) return identityFailure;
        this.dependencies.migrationRetry.cancel();
        this.emit(
          request,
          'Gateway service restarted, reconnecting…',
          1,
          'gateway.progress.restartDone',
          undefined,
          'completed',
        );
        return { ...restarted, action: request.action, source: request.source };
      }

      const message = errorMessage(restarted.error, 'Gateway restart failed');
      if (gatewayMigrationRetryDelayMs(message) > 0 && message !== currentDiagnostic) {
        currentDiagnostic = message;
        continue;
      }
      this.emit(request, `Restart failed: ${message}`, 1, 'gateway.progress.restartFailed', { error: message }, 'failed');
      return { success: false, error: message, action: request.action, source: request.source };
    }
  }

  /**
   * Returns a failure result when the restarted endpoint is not the selected
   * Gateway, or null when the check passes or is not configured. A probe that
   * throws is treated as unverified: an unreachable check must not upgrade to
   * an implicit pass.
   */
  private async verifyRestartedIdentity(
    request: GatewayLifecycleRequest,
  ): Promise<GatewayLifecycleResult | null> {
    const verify = this.dependencies.verifySelectedIdentity;
    if (!verify) return null;
    let verified = false;
    try {
      verified = await verify();
    } catch {
      verified = false;
    }
    if (verified) return null;
    const message = 'Gateway restarted, but the endpoint does not match the selected runtime.';
    this.emit(request, message, 1, 'gateway.progress.restartIdentityFailed', { error: message }, 'failed');
    return { success: false, error: message, action: request.action, source: request.source };
  }

  private emitSuperseded(request: GatewayLifecycleRequest): void {
    const message = 'Gateway operation was superseded by a newer lifecycle request.';
    this.emit(request, message, 1, 'gateway.progress.superseded', undefined, 'failed');
  }

  private emit(
    request: GatewayLifecycleRequest,
    message: string,
    progress: number,
    key: string,
    params?: Record<string, unknown>,
    status: GatewayRecoveryStatus = 'running',
  ): void {
    const detail: GatewayLifecycleProgress = {
      step: 'gateway',
      message,
      progress,
      key,
      params,
      status,
      action: request.action,
      source: request.source,
    };
    for (const listener of this.listeners) {
      try {
        listener(detail);
      } catch {
        // Progress observers are not part of the lifecycle transaction.
      }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('aegis:gateway-progress', { detail }));
      } catch {
        // A UI notification failure must not change the Gateway result.
      }
    }
  }
}

export function createGatewayLifecycleCoordinator(
  manager: GatewayLifecycleManager,
  verifySelectedIdentity?: () => Promise<boolean>,
): GatewayLifecycleCoordinator {
  return new GatewayLifecycleCoordinator({
    manager,
    migrationRetry: createGatewayMigrationRetryCoordinator(),
    ...(verifySelectedIdentity ? { verifySelectedIdentity } : {}),
  });
}
