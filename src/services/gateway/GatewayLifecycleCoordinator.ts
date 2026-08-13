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
  settlementTimeoutMs?: number;
  deadline?: number;
  signal?: AbortSignal;
  restartAttemptLimit?: number;
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
  finishDirectRecovery: () => void;
}

interface GatewayLifecycleConnectionSettlement {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  waitForConnection: (
    previousConnectionId: string | null,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<string>;
}

type ProgressListener = (progress: GatewayLifecycleProgress) => void;

export interface GatewayLifecycleDeadlineBoundary {
  deadline: number;
  signal: AbortSignal;
}

export interface GatewayLifecycleIdleReceipt {
  generation: number;
  restartAttemptGeneration: number;
  observedRestart: boolean;
}

type CoordinatorDependencies = {
  manager: GatewayLifecycleManager;
  connection: GatewayLifecycleConnectionSettlement;
  migrationRetry: GatewayMigrationRetryCoordinator;
  /**
   * 重启后重新证明端点属于当前选择的运行时。仅端口健康无法排除同端口的其他
   * Gateway；测试不覆盖该后置条件时才允许省略。
   */
  verifySelectedIdentity?: (expectedConnectionId: string) => Promise<boolean>;
  captureRuntimeScope?: () => string | null;
};

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string' && value) return value;
  return fallback;
}

function remainingLifecycleBudget(deadline: number): number | null {
  const remainingMs = deadline - Date.now();
  return remainingMs > 0 ? remainingMs : null;
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
  private lifecycleGeneration = 0;
  private restartAttemptGeneration = 0;
  private activeRestartAttemptGeneration: number | null = null;
  private readonly setupCompensationRestarts = new Set<string>();
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

  async reconnectSelectedRuntimeAfterCurrent(
    source: string,
    boundary?: GatewayLifecycleDeadlineBoundary,
  ): Promise<GatewayLifecycleResult> {
    // Wizard 终态交接必须取得一次属于自己的新连接结果，不能复用正在结束的重启
    // 或恢复请求，否则上一个请求的来源和终态会被误当作本次核验结果。
    const deadline = boundary?.deadline ?? null;
    const settled = await this.waitForActiveLifecycle(deadline, boundary?.signal);
    if (!settled) {
      return this.lifecycleDeadlineFailure('reconnect', source);
    }
    const remainingTimeoutMs = deadline ? remainingLifecycleBudget(deadline) : undefined;
    if (deadline !== null && remainingTimeoutMs === null) {
      return this.lifecycleDeadlineFailure('reconnect', source);
    }
    return this.request({
      action: 'reconnect',
      source,
      selectedRuntime: true,
      ...(remainingTimeoutMs ? { settlementTimeoutMs: remainingTimeoutMs } : {}),
      ...(boundary ? { deadline: boundary.deadline, signal: boundary.signal } : {}),
    });
  }

  recover(source: string, diagnostic?: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'recover', source, diagnostic });
  }

  restart(
    source: string,
    diagnostic?: string,
    settlementTimeoutMs?: number,
  ): Promise<GatewayLifecycleResult> {
    return this.request({
      action: 'restart',
      source,
      diagnostic,
      ...(settlementTimeoutMs ? { settlementTimeoutMs } : {}),
    });
  }

  async restartAfterCurrent(
    source: string,
    diagnostic: string | undefined,
    boundary: GatewayLifecycleDeadlineBoundary,
    configRevisionHash: string,
  ): Promise<GatewayLifecycleResult> {
    const settled = await this.waitForActiveLifecycle(boundary.deadline, boundary.signal);
    if (!settled) return this.lifecycleDeadlineFailure('restart', source);
    const remainingTimeoutMs = remainingLifecycleBudget(boundary.deadline);
    if (remainingTimeoutMs === null) return this.lifecycleDeadlineFailure('restart', source);
    const runtimeScope = this.dependencies.captureRuntimeScope?.()?.trim() ?? '';
    const revisionHash = configRevisionHash.trim();
    if (!runtimeScope || !revisionHash) {
      return {
        success: false,
        error: 'Gateway setup compensation requires an attested runtime scope and configuration revision.',
        action: 'restart',
        source,
      };
    }
    const compensationKey = `${runtimeScope}\u0000${revisionHash}`;
    if (this.setupCompensationRestarts.has(compensationKey)) {
      return {
        success: false,
        error: 'Gateway setup compensation was already attempted for this runtime configuration revision.',
        action: 'restart',
        source,
      };
    }
    // 在副作用排队前登记幂等边界。即使结果未知，后续交接也只能核验，不能重放。
    this.setupCompensationRestarts.add(compensationKey);
    return this.request({
      action: 'restart',
      source,
      diagnostic,
      settlementTimeoutMs: remainingTimeoutMs,
      deadline: boundary.deadline,
      signal: boundary.signal,
      restartAttemptLimit: 1,
    });
  }

  stop(source: string): Promise<GatewayLifecycleResult> {
    return this.request({ action: 'stop', source });
  }

  request(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    if (this.isDeadlineExceeded(request)) return Promise.resolve(this.deadlineFailure(request));
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

    this.lifecycleGeneration += 1;
    this.activeRestartAttemptGeneration = null;
    const operation = this.executeSafely(request);
    this.active = operation;
    this.activeAction = request.action;
    void operation.then(() => {
      if (this.active === operation) {
        this.active = null;
        this.activeAction = null;
        this.activeRestartAttemptGeneration = null;
      }
    });
    return operation;
  }

  cancelMigrationWait(): boolean {
    return this.dependencies.migrationRetry.cancel();
  }

  /** 等待既有生命周期释放并返回单调代次；调用方仍需在提交成功前复核代次。 */
  async waitForIdle(
    boundary: GatewayLifecycleDeadlineBoundary,
  ): Promise<GatewayLifecycleIdleReceipt | null> {
    const restartGenerationAtEntry = this.restartAttemptGeneration;
    let observedRestart = this.activeRestartAttemptGeneration !== null;
    while (this.active) {
      const active = this.active;
      if (!(await this.waitForOperation(active, boundary.deadline, boundary.signal))) return null;
      if (this.restartAttemptGeneration > restartGenerationAtEntry) observedRestart = true;
      const pendingUpgrade = this.pendingUpgradeResult;
      if (pendingUpgrade) {
        if (!(await this.waitForOperation(pendingUpgrade, boundary.deadline, boundary.signal))) return null;
        if (this.restartAttemptGeneration > restartGenerationAtEntry) observedRestart = true;
      }
    }
    if (boundary.signal.aborted || Date.now() >= boundary.deadline) return null;
    return {
      generation: this.lifecycleGeneration,
      restartAttemptGeneration: this.restartAttemptGeneration,
      observedRestart,
    };
  }

  /** 证明 receipt 之后没有新的恢复、重连、重启或停止事务插入。 */
  isIdleReceiptCurrent(receipt: GatewayLifecycleIdleReceipt): boolean {
    return this.active === null
      && this.pendingUpgradeResult === null
      && receipt.generation === this.lifecycleGeneration;
  }

  /** 等待既有生命周期释放，调用方不得据此推断连接或运行时已经可用。 */
  private async waitForActiveLifecycle(
    deadline: number | null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    while (this.active) {
      const active = this.active;
      if (!(await this.waitForOperation(active, deadline, signal))) return false;
      const pendingUpgrade = this.pendingUpgradeResult;
      if (pendingUpgrade && !(await this.waitForOperation(pendingUpgrade, deadline, signal))) return false;
    }
    return !signal?.aborted && (deadline === null || Date.now() < deadline);
  }

  private async waitForOperation(
    operation: Promise<GatewayLifecycleResult>,
    deadline: number | null,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (signal?.aborted) return false;
    if (deadline === null && !signal) {
      await operation;
      return true;
    }
    const remainingMs = deadline === null ? null : deadline - Date.now();
    if (remainingMs !== null && remainingMs <= 0) return false;
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
    const timeoutMarker = {};
    const timeout = new Promise<typeof timeoutMarker>((resolve) => {
      if (remainingMs !== null) timer = globalThis.setTimeout(resolve, remainingMs, timeoutMarker);
    });
    const onAbort = () => abortWait?.(timeoutMarker);
    let abortWait: ((marker: typeof timeoutMarker) => void) | null = null;
    const aborted = new Promise<typeof timeoutMarker>((resolve) => {
      abortWait = resolve;
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return (await Promise.race([operation, timeout, aborted])) !== timeoutMarker;
    } finally {
      if (timer) globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private lifecycleDeadlineFailure(
    action: Extract<GatewayLifecycleAction, 'reconnect' | 'restart'>,
    source: string,
  ): GatewayLifecycleResult {
    const message = 'Gateway lifecycle exceeded the setup handoff deadline.';
    return { success: false, error: message, action, source };
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
      if (this.isDeadlineExceeded(upgrade)) return this.deadlineFailure(upgrade);
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
    } finally {
      this.dependencies.manager.finishDirectRecovery();
    }
  }

  private async execute(request: GatewayLifecycleRequest): Promise<GatewayLifecycleResult> {
    if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
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
      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
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
    let restartCommandAttempts = 0;
    while (true) {
      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
      if (
        request.restartAttemptLimit !== undefined
        && restartCommandAttempts >= request.restartAttemptLimit
      ) {
        const message = 'Gateway restart was not repeated after the first compensation attempt.';
        this.emit(request, message, 1, 'gateway.progress.restartFailed', { error: message }, 'failed');
        return { success: false, error: message, action: request.action, source: request.source };
      }
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
        const remainingMs = this.remainingRequestBudget(request);
        if (remainingMs === null) return this.deadlineFailure(request);
        const waitMs = remainingMs === undefined ? delayMs : Math.min(delayMs, remainingMs);
        if (!(await this.waitForMigration(waitMs, request))) {
          if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
          const message = 'Gateway restart cancelled while waiting for startup migration.';
          this.emit(request, message, 1, 'gateway.progress.restartFailed', { error: message }, 'failed');
          return { success: false, error: message, action: request.action, source: request.source };
        }
        if (waitMs < delayMs || this.isDeadlineExceeded(request)) {
          return this.deadlineFailure(request);
        }
      }

      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
      restartCommandAttempts += 1;
      this.restartAttemptGeneration += 1;
      this.activeRestartAttemptGeneration = this.restartAttemptGeneration;
      this.emit(request, 'Restarting OpenClaw Gateway…', 0.1, 'gateway.progress.restart');
      let restarted: GatewayRestartResult;
      try {
        // 原生重启开始后必须自然收敛并持续占有进程操作锁。前端截止时间只决定
        // 是否继续重连和发布完成，不能通过丢弃原生 Promise 假装副作用已取消。
        restarted = await this.dependencies.manager.restart();
      } catch (error) {
        restarted = { success: false, error: errorMessage(error, 'Gateway restart failed') };
      }
      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
      if (restarted.superseded) {
        this.emitSuperseded(request);
        return { success: false, superseded: true, action: request.action, source: request.source };
      }
      if (restarted.success) {
        this.dependencies.migrationRetry.cancel();
        this.emit(
          request,
          'Gateway service restarted, reconnecting…',
          0.7,
          'gateway.progress.restartDone',
        );
        if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
        this.dependencies.manager.reconnectSelectedRuntime();
        const connected = await this.waitForConnection(request, previousConnectionId, false);
        if (!connected.success) return connected;
        const identityFailure = await this.verifyRestartedIdentity(request, connected.connectionId ?? '');
        if (identityFailure) return identityFailure;
        this.emit(
          request,
          'Gateway connection and selected runtime identity verified.',
          1,
          'gateway.progress.connectionReady',
          undefined,
          'completed',
        );
        return { ...restarted, ...connected };
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
    publishCompletion = true,
  ): Promise<GatewayLifecycleResult> {
    this.emit(
      request,
      'Waiting for an authenticated Gateway connection…',
      0.85,
      'gateway.progress.connectionWaiting',
    );
    try {
      const connectionId = await this.dependencies.connection.waitForConnection(
        previousConnectionId,
        this.remainingSettlementBudget(request),
        request.signal,
      );
      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
      if (publishCompletion) {
        this.emit(
          request,
          'Gateway connection and runtime identity verified.',
          1,
          'gateway.progress.connectionReady',
          undefined,
          'completed',
        );
      }
      return { success: true, action: request.action, source: request.source, connectionId };
    } catch (error) {
      if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
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
    expectedConnectionId: string,
  ): Promise<GatewayLifecycleResult | null> {
    if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
    const verify = this.dependencies.verifySelectedIdentity;
    if (!verify) return null;
    if (!expectedConnectionId || !this.dependencies.connection.isConnectionCurrent(expectedConnectionId)) {
      return this.restartIdentityFailure(request);
    }
    let verified = false;
    try {
      verified = await verify(expectedConnectionId);
    } catch {
      verified = false;
    }
    if (this.isDeadlineExceeded(request)) return this.deadlineFailure(request);
    if (
      verified
      && this.dependencies.connection.isConnectionCurrent(expectedConnectionId)
    ) return null;
    return this.restartIdentityFailure(request);
  }

  private restartIdentityFailure(
    request: GatewayLifecycleRequest,
  ): GatewayLifecycleResult {
    const message = 'Gateway restarted, but the endpoint does not match the selected runtime.';
    this.emit(request, message, 1, 'gateway.progress.restartIdentityFailed', { error: message }, 'failed');
    return { success: false, error: message, action: request.action, source: request.source };
  }

  private isDeadlineExceeded(request: GatewayLifecycleRequest): boolean {
    return request.signal?.aborted === true
      || (request.deadline !== undefined && Date.now() >= request.deadline);
  }

  private remainingRequestBudget(request: GatewayLifecycleRequest): number | undefined | null {
    if (this.isDeadlineExceeded(request)) return null;
    return request.deadline === undefined ? undefined : Math.max(1, request.deadline - Date.now());
  }

  private remainingSettlementBudget(request: GatewayLifecycleRequest): number | undefined {
    const deadlineBudget = this.remainingRequestBudget(request);
    if (deadlineBudget === null) return 1;
    if (deadlineBudget === undefined) return request.settlementTimeoutMs;
    return request.settlementTimeoutMs === undefined
      ? deadlineBudget
      : Math.min(request.settlementTimeoutMs, deadlineBudget);
  }

  private async waitForMigration(delayMs: number, request: GatewayLifecycleRequest): Promise<boolean> {
    if (!request.signal) return this.dependencies.migrationRetry.wait(delayMs);
    if (request.signal.aborted) return false;
    const wait = this.dependencies.migrationRetry.wait(delayMs);
    let abortWait: ((value: false) => void) | null = null;
    const onAbort = () => {
      this.dependencies.migrationRetry.cancel();
      abortWait?.(false);
    };
    const aborted = new Promise<false>((resolve) => {
      abortWait = resolve;
      request.signal!.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([wait, aborted]);
    } finally {
      request.signal.removeEventListener('abort', onAbort);
    }
  }

  private deadlineFailure(request: GatewayLifecycleRequest): GatewayLifecycleResult {
    const message = 'Gateway lifecycle exceeded the setup handoff deadline.';
    this.emit(request, message, 1, 'gateway.progress.restartFailed', { error: message }, 'failed');
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
        // 进度观察器不属于生命周期事务，观察器异常不得改变操作结果。
      }
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('aegis:gateway-progress', { detail }));
      } catch {
        // 界面事件分发失败不得改变 Gateway 生命周期结果。
      }
    }
  }
}

export function createGatewayLifecycleCoordinator(
  manager: GatewayLifecycleManager,
  connection: GatewayLifecycleConnectionSettlement,
  verifySelectedIdentity?: (expectedConnectionId: string) => Promise<boolean>,
  captureRuntimeScope?: () => string | null,
): GatewayLifecycleCoordinator {
  return new GatewayLifecycleCoordinator({
    manager,
    connection,
    migrationRetry: createGatewayMigrationRetryCoordinator(),
    ...(verifySelectedIdentity ? { verifySelectedIdentity } : {}),
    ...(captureRuntimeScope ? { captureRuntimeScope } : {}),
  });
}
