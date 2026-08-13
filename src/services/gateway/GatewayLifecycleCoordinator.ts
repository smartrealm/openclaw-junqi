import {
  createGatewayMigrationRetryCoordinator,
  gatewayMigrationRetryDelayMs,
  type GatewayMigrationRetryCoordinator,
} from '@/runtime/openclawRepair';
import type { GatewayRecoveryStatus } from './recoveryProgress';

export type GatewayLifecycleAction = 'reconnect' | 'recover' | 'restart' | 'stop';

export interface GatewayLifecycleRequest {
  action: GatewayLifecycleAction;
  source: string;
  diagnostic?: string;
  selectedRuntime?: boolean;
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
  connectionId?: string;
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
  stop: () => Promise<GatewayRestartResult>;
  reconnect: () => void;
  reconnectSelectedRuntime: () => void;
}

interface GatewayLifecycleConnectionSettlement {
  captureConnectionId: () => string | null;
  waitForConnection: (previousConnectionId: string | null) => Promise<string>;
}

type ProgressListener = (progress: GatewayLifecycleProgress) => void;

type CoordinatorDependencies = {
  manager: GatewayLifecycleManager;
  connection: GatewayLifecycleConnectionSettlement;
  migrationRetry: GatewayMigrationRetryCoordinator;
  /**
   * 重启后重新证明端点属于当前选择的运行时。仅端口健康无法排除同端口的其他
   * Gateway；测试不覆盖该后置条件时才允许省略。
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
  stop: 3,
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

  async reconnectSelectedRuntimeAfterCurrent(source: string): Promise<GatewayLifecycleResult> {
    // Wizard 终态交接必须取得一次属于自己的新连接结果，不能复用正在结束的重启
    // 或恢复请求，否则上一个请求的来源和终态会被误当作本次核验结果。
    while (this.active) {
      const active = this.active;
      await active;
      const pendingUpgrade = this.pendingUpgradeResult;
      if (pendingUpgrade) await pendingUpgrade;
    }
    return this.request({ action: 'reconnect', source, selectedRuntime: true });
  }

  recover(source: string, diagnostic?: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'recover', source, diagnostic });
  }

  restart(source: string, diagnostic?: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'restart', source, diagnostic });
  }

  stop(source: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'stop', source });
  }

  request(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    if (this.active) {
      if (request.action === 'stop' || this.activeAction === 'stop') {
        if (request.action === this.activeAction) return this.active;
        if (!this.pendingUpgrade || ACTION_STRENGTH[request.action] > ACTION_STRENGTH[this.pendingUpgrade.action]) {
          this.pendingUpgrade = request;
        }
        return this.schedulePendingUpgrade();
      }
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
    const previousConnectionId = this.dependencies.connection.captureConnectionId();
    if (request.action === 'stop') {
      this.emit(request, 'Stopping the selected OpenClaw Gateway…', 0.1, 'gateway.progress.stop');
      const stopped = await this.dependencies.manager.stop();
      if (!stopped.success) {
        const message = errorMessage(stopped.error, 'Gateway stop failed');
        this.emit(request, message, 1, 'gateway.progress.stopFailed', { error: message }, 'failed');
        return { ...stopped, success: false, error: message, action: request.action, source: request.source };
      }
      this.emit(
        request,
        'Gateway stopped.',
        1,
        'gateway.progress.stopDone',
        undefined,
        'completed',
      );
      return { ...stopped, success: true, action: request.action, source: request.source };
    }
    if (request.action === 'reconnect') {
      this.emit(request, 'Reconnecting to OpenClaw Gateway…', 0.1, 'gateway.progress.reconnect');
      if (request.selectedRuntime) this.dependencies.manager.reconnectSelectedRuntime();
      else this.dependencies.manager.reconnect();
      return this.waitForConnection(request, previousConnectionId);
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
            // 未返回的模式是未知，不是 Native；用户可见进度不得越过运行时边界猜测平台。
            ensured.mode
              ? `Gateway healthy (${ensured.mode}), reconnecting…`
              : 'Gateway healthy, reconnecting…',
            0.55,
            'gateway.progress.gatewayHealthy',
          );
          const connected = await this.waitForConnection(request, previousConnectionId);
          return connected.success
            ? { ...connected, healthy: true, mode: ensured.mode }
            : connected;
        }
        return this.executeRestart(request, previousConnectionId, ensured.error ?? request.diagnostic);
      } catch (error) {
        return this.executeRestart(
          request,
          previousConnectionId,
          errorMessage(error, request.diagnostic ?? 'Gateway recovery failed'),
        );
      }
    }

    return this.executeRestart(request, previousConnectionId, request.diagnostic);
  }

  private async executeRestart(
    request: GatewayLifecycleRequest,
    previousConnectionId: string | null,
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
          0.7,
          'gateway.progress.restartDone',
        );
        const connected = await this.waitForConnection(request, previousConnectionId);
        return connected.success
          ? { ...restarted, ...connected }
          : connected;
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

  private async waitForConnection(
    request: GatewayLifecycleRequest,
    previousConnectionId: string | null,
  ): Promise<GatewayLifecycleResult> {
    this.emit(
      request,
      'Waiting for an authenticated Gateway connection…',
      0.85,
      'gateway.progress.connectionWaiting',
    );
    try {
      const connectionId = await this.dependencies.connection.waitForConnection(previousConnectionId);
      this.emit(
        request,
        'Gateway connection and runtime identity verified.',
        1,
        'gateway.progress.connectionReady',
        undefined,
        'completed',
      );
      return { success: true, action: request.action, source: request.source, connectionId };
    } catch (error) {
      const message = errorMessage(error, 'Gateway connection verification failed');
      this.emit(
        request,
        message,
        1,
        'gateway.progress.connectionFailed',
        { error: message },
        'failed',
      );
      return { success: false, error: message, action: request.action, source: request.source };
    }
  }

  /**
   * 端点不属于当前选择的 Gateway 时返回失败；探测异常保持未核验，不能升级为通过。
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
  connection: GatewayLifecycleConnectionSettlement,
  verifySelectedIdentity?: () => Promise<boolean>,
): GatewayLifecycleCoordinator {
  return new GatewayLifecycleCoordinator({
    manager,
    connection,
    migrationRetry: createGatewayMigrationRetryCoordinator(),
    ...(verifySelectedIdentity ? { verifySelectedIdentity } : {}),
  });
}
