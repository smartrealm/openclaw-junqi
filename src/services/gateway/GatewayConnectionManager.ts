// Gateway 连接编排层：组合状态机、动作执行器和事件订阅。

import { gateway } from './index';
import { GatewayStateMachine, type GatewayAction } from './GatewayStateMachine';
import {
  executeConnect,
  executeDockerStart,
  executeStart,
  type GatewayConnectActionOptions,
} from './GatewayActionExecutor';
import { LifecycleEpoch } from './LifecycleEpoch';
import {
  ensureSelectedGatewayRuntime,
  readGatewayProcessRuntimeStatus,
  restartSelectedGatewayRuntime,
  stopSelectedGatewayRuntime,
  subscribeGatewayProcessRuntime,
  type GatewayProcessRuntimeStatus,
} from './gatewayProcessObservation';
import {
  type GatewayEvent,
  type GatewayStartResult,
  type GatewayStateSnapshot,
} from './types';
import type {
  GatewayEnsureResult,
  GatewayRestartResult,
} from './GatewayLifecycleCoordinator';

type StateListener = (snapshot: GatewayStateSnapshot) => void;

interface GatewayActionExecutorPort {
  connect(
    onHttpUrl: (url: string) => void,
    isCurrent?: () => boolean,
    options?: GatewayConnectActionOptions,
  ): Promise<void>;
  start: typeof executeStart;
  startDocker: typeof executeDockerStart;
}

interface GatewayProcessRuntimePort {
  observe: () => Promise<GatewayProcessRuntimeStatus>;
  subscribe: (listener: (status: GatewayProcessRuntimeStatus) => void) => () => void;
  ensure: () => Promise<GatewayEnsureResult>;
  restart: () => Promise<GatewayRestartResult>;
  stop: () => Promise<GatewayRestartResult>;
}

interface GatewayConnectionTransportPort {
  connect(url: string, token: string, deviceToken?: string): void;
  reconnectWithToken(token: string): void;
  disconnect(): void;
}

const defaultGatewayActionExecutor: GatewayActionExecutorPort = {
  connect: executeConnect,
  start: executeStart,
  startDocker: executeDockerStart,
};
const defaultGatewayProcessRuntime: GatewayProcessRuntimePort = {
  observe: readGatewayProcessRuntimeStatus,
  subscribe: subscribeGatewayProcessRuntime,
  ensure: ensureSelectedGatewayRuntime,
  restart: restartSelectedGatewayRuntime,
  stop: stopSelectedGatewayRuntime,
};
const defaultGatewayConnectionTransport: GatewayConnectionTransportPort = {
  connect: (url, token, deviceToken) => gateway.connect(url, token, deviceToken),
  reconnectWithToken: (token) => gateway.reconnectWithToken(token),
  disconnect: () => gateway.disconnect(),
};

export class GatewayConnectionManager {
  private fsm = new GatewayStateMachine();
  private listeners = new Set<StateListener>();
  private error: string | null = null;
  private retrying = false;
  private selectedGatewayReady = false;
  private logs: { stdout: string; stderr: string } | undefined;
  private statusUnsub: (() => void) | undefined;
  private pendingStart: {
    promise: Promise<GatewayStartResult>;
    resolve: (result: GatewayStartResult) => void;
    reject: (error: Error) => void;
    generation: number;
  } | null = null;
  private useSelectedRuntimeForNextConnection = false;
  private readonly lifecycleEpoch = new LifecycleEpoch();

  constructor(
    private readonly actionExecutor: GatewayActionExecutorPort = defaultGatewayActionExecutor,
    private readonly processRuntime: GatewayProcessRuntimePort = defaultGatewayProcessRuntime,
    private readonly connectionTransport: GatewayConnectionTransportPort = defaultGatewayConnectionTransport,
  ) {}

  /** 订阅状态变化并返回取消函数。 */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** 初始化进程状态订阅与探测。 */
  init(): void {
    this.rejectPendingStart('Gateway manager was reinitialized');
    const generation = this.lifecycleEpoch.activate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.dispatch({ type: 'INITIALIZE' });

    this.statusUnsub = this.processRuntime.subscribe((status) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        processAlive: Boolean(status.processAlive ?? status.running),
        endpointReady: Boolean(status.ready),
        error: status.error ?? null,
        retrying: Boolean(status.retrying),
        logs: status.logs,
      });
    });

  }

  /** 接收 App 转发的 WebSocket 已连接事实。 */
  notifyWsOpen(): void {
    this.dispatch({ type: 'WS_OPEN' });
  }

  /** 接收 App 转发的 WebSocket 已断开事实。 */
  notifyWsClose(): void {
    this.dispatch({ type: 'WS_CLOSE' });
  }

  /** 从错误状态触发一次重试。 */
  retry(): void {
    this.beginRecovery('RETRY');
  }

  /** 配置变化后重置为探测状态。 */
  reset(): void {
    this.invalidateLifecycle('Gateway lifecycle was reset');
    this.dispatch({ type: 'RESET' });
  }

  /**
   * 立即探测 Gateway 进程并驱动状态机，避免 reset 后等待周期探测。
   */
  probe(): void {
    const generation = this.lifecycleEpoch.capture();
    void this.processRuntime.observe().then((status) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        processAlive: Boolean(status.processAlive ?? status.running),
        endpointReady: Boolean(status.ready),
        error: status.error ?? null,
        retrying: Boolean(status.retrying),
        logs: status.logs,
      });
    }).catch((error) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        processAlive: false,
        endpointReady: false,
        error: String(error),
        retrying: false,
      });
    });
  }

  /** 重置状态机并立即探测，主动建立新连接。 */
  reconnect(): void {
    this.activateForDirectRecovery();
    this.beginRecovery('RESET');
  }

  startForSetup(): Promise<GatewayStartResult> {
    return this.requestSetupStart('START_REQUESTED');
  }

  startDockerForSetup(): Promise<GatewayStartResult> {
    return this.requestSetupStart('DOCKER_START_REQUESTED');
  }

  private requestSetupStart(event: 'START_REQUESTED' | 'DOCKER_START_REQUESTED'): Promise<GatewayStartResult> {
    if (this.pendingStart) return this.pendingStart.promise;
    this.activateForDirectRecovery();
    // 首次设置必须从所选运行时建立新的认证连接，旧连接不能作为本次启动成功证据。
    this.connectionTransport.disconnect();
    this.useSelectedRuntimeForNextConnection = true;
    // 启动请求已经由 pendingStart 串行化，此处保留当前状态订阅代次，避免丢弃
    // 该启动操作随后产生的运行时状态。
    const generation = this.lifecycleEpoch.capture();
    let resolve!: (result: GatewayStartResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<GatewayStartResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.pendingStart = { promise, resolve, reject, generation };
    this.dispatch({ type: event });
    return promise;
  }

  async ensureRunning(): Promise<GatewayEnsureResult> {
    const generation = this.beginProcessRecovery();
    let result: GatewayEnsureResult;
    try {
      result = await this.processRuntime.ensure();
    } catch (error) {
      result = { healthy: false, error: String(error) };
    }
    if (!this.isCurrent(generation)) return { ...result, superseded: true };
    if (result?.healthy) {
      this.dispatch({ type: 'SELECTED_GATEWAY_READY' });
      this.reconnect();
    } else {
      this.dispatch({
        type: 'STATUS_RECEIVED',
          processAlive: false,
          endpointReady: false,
        error: result?.error ?? 'Gateway recovery failed',
        retrying: false,
      });
    }
    return result;
  }

  async restart(): Promise<GatewayRestartResult> {
    const generation = this.beginProcessRecovery();
    let result: GatewayRestartResult;
    try {
      result = await this.processRuntime.restart();
    } catch (error) {
      result = { success: false, error: String(error) };
    }
    if (!this.isCurrent(generation)) return { ...result, superseded: true };
    if (result?.success === false) {
      this.dispatch({
        type: 'STATUS_RECEIVED',
        processAlive: false,
        endpointReady: false,
        error: result.error ?? 'Gateway restart failed',
        retrying: false,
      });
      return result;
    }
    this.reconnect();
    return result;
  }

  async stop(): Promise<GatewayRestartResult> {
    const generation = this.beginProcessRecovery();
    let result: GatewayRestartResult;
    try {
      result = await this.processRuntime.stop();
    } catch (error) {
      result = { success: false, error: String(error) };
    }
    if (!this.isCurrent(generation)) return { ...result, superseded: true };
    if (result.success === false) {
      this.dispatch({
        type: 'STATUS_RECEIVED',
        processAlive: false,
        endpointReady: false,
        error: result.error ?? 'Gateway stop failed',
        retrying: false,
      });
      return result;
    }
    this.connectionTransport.disconnect();
    this.dispatch({
      type: 'STATUS_RECEIVED',
      processAlive: false,
      endpointReady: false,
      error: null,
      retrying: false,
    });
    return result;
  }

  reconnectWithToken(token: string): void {
    this.invalidateLifecycle('Gateway credentials changed');
    this.dispatch({ type: 'RESET' });
    this.connectionTransport.reconnectWithToken(token);
  }

  connect(url: string, token: string, deviceToken = ''): void {
    this.invalidateLifecycle('Gateway connection target changed');
    this.dispatch({ type: 'RESET' });
    this.connectionTransport.connect(url, token, deviceToken);
  }

  /** 卸载时清理状态订阅与连接。 */
  destroy(): void {
    this.lifecycleEpoch.deactivate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.rejectPendingStart('Gateway manager was destroyed');
    this.listeners.clear();
    this.connectionTransport.disconnect();
  }

  // Gateway 连接事实与动作意图统一提交到该状态机入口。
  private dispatch(event: GatewayEvent): void {
    if (!this.lifecycleEpoch.isActive()) return;
    if (event.type === 'STATUS_RECEIVED' && this.pendingStart) {
      // 显式启动尚未返回时，状态订阅只补充诊断日志；启动结果才有权触发首次连接。
      // 否则端点就绪事件可能抢先消耗所选运行时的连接策略并复用错误目标。
      if (event.logs) this.logs = event.logs;
      this.emit();
      return;
    }
    if (event.type === 'INITIALIZE') {
      this.logs = undefined;
      this.retrying = false;
      this.error = null;
      this.selectedGatewayReady = false;
    } else if (event.type === 'RECOVERY_REQUESTED') {
      this.retrying = true;
      this.error = null;
      this.selectedGatewayReady = false;
    } else if (event.type === 'STATUS_RECEIVED') {
      if (event.logs) this.logs = event.logs;
      this.retrying = event.retrying;
      this.error = event.error;
      if (typeof event.endpointReady === 'boolean') {
        this.selectedGatewayReady = event.endpointReady;
      }
    } else if (event.type === 'SELECTED_GATEWAY_READY') {
      this.selectedGatewayReady = true;
    } else if (event.type === 'START_FAILED') {
      this.error = event.error;
      this.retrying = false;
      this.selectedGatewayReady = false;
    } else if (event.type === 'CONNECT_FAILED') {
      this.error = event.error;
      this.retrying = false;
      this.selectedGatewayReady = false;
    } else if (
      event.type === 'RESET'
      || event.type === 'RETRY'
      || event.type === 'WS_OPEN'
      || event.type === 'START_REQUESTED'
      || event.type === 'DOCKER_START_REQUESTED'
    ) {
      this.error = null;
      this.retrying = false;
    }

    const result = this.fsm.transition(event);

    // 执行状态机返回的副作用动作。
    for (const action of result.actions) {
      this.executeAction(action, this.lifecycleEpoch.capture());
    }

    this.emit();
  }

  private executeAction(action: GatewayAction, generation: number): void {
    switch (action) {
      case 'CONNECT': {
        const connectOptions = this.useSelectedRuntimeForNextConnection
          ? { targetRequest: { targetScope: 'selected-runtime' as const } }
          : undefined;
        this.useSelectedRuntimeForNextConnection = false;
        void this.actionExecutor.connect(
          (httpUrl) => {
            if (!this.isCurrent(generation)) return;
            // App.tsx 使用该地址解析媒体资源并呈现配对入口。
            window.dispatchEvent(new CustomEvent('aegis:gateway-http-url', { detail: httpUrl }));
          },
          () => this.isCurrent(generation),
          connectOptions,
        ).catch((error) => {
          if (!this.isCurrent(generation)) return;
          this.dispatch({ type: 'CONNECT_FAILED', error: String(error) });
        });
        break;
      }
      case 'START':
        void this.actionExecutor.start()
          .then((result) => this.completeStart(result, generation))
          .catch((error) => this.completeStart({ success: false, error: String(error) }, generation));
        break;
      case 'START_DOCKER':
        void this.actionExecutor.startDocker()
          .then((result) => this.completeStart(result, generation))
          .catch((error) => this.completeStart({ success: false, error: String(error) }, generation));
        break;
      case 'SHOW_ERROR':
        // 错误已由 dispatch 提交到快照。
        break;
      case 'NONE':
        break;
    }
  }

  private snapshot(): GatewayStateSnapshot {
    return {
      ...this.fsm.snapshot(this.error, this.retrying, this.selectedGatewayReady),
      logs: this.logs,
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach(l => l(snap));
  }

  private isCurrent(generation: number): boolean {
    return this.lifecycleEpoch.isCurrent(generation);
  }

  private activateForDirectRecovery(): void {
    // 首次配置阶段尚未挂载 App 的常驻 Gateway 生命周期；显式恢复仍要能执行
    // 一次进程探测和连接，不能因管理器未初始化而静默丢弃事件。
    if (this.lifecycleEpoch.isActive()) return;
    this.lifecycleEpoch.activate();
    this.dispatch({ type: 'INITIALIZE' });
  }

  private beginRecovery(event: 'RESET' | 'RETRY'): void {
    this.invalidateLifecycle('A newer Gateway recovery was requested');
    this.dispatch({ type: event });
    this.connectionTransport.disconnect();
    this.probe();
  }

  private completeStart(result: GatewayStartResult, generation: number): void {
    if (!this.isCurrent(generation)) {
      if (this.pendingStart?.generation === generation) {
        this.rejectPendingStart('Gateway start was superseded by a newer lifecycle');
      }
      return;
    }
    if (result?.success) {
      this.dispatch({ type: 'SELECTED_GATEWAY_READY' });
      this.dispatch({ type: 'START_SUCCESS' });
      this.pendingStart?.resolve(result);
    } else {
      this.useSelectedRuntimeForNextConnection = false;
      this.connectionTransport.disconnect();
      const error = result?.error || 'Failed to start gateway';
      this.dispatch({ type: 'START_FAILED', error });
      this.pendingStart?.reject(new Error(error));
    }
    this.pendingStart = null;
  }

  private beginProcessRecovery(): number {
    this.invalidateLifecycle('A newer Gateway process recovery was requested');
    this.dispatch({ type: 'RECOVERY_REQUESTED' });
    return this.lifecycleEpoch.capture();
  }

  private invalidateLifecycle(reason: string): void {
    this.rejectPendingStart(reason);
    this.useSelectedRuntimeForNextConnection = false;
    this.lifecycleEpoch.invalidate();
  }

  private rejectPendingStart(reason: string): void {
    this.pendingStart?.reject(new Error(reason));
    this.pendingStart = null;
  }
}

/** 应用内共享的连接管理器单例。 */
export const gatewayManager = new GatewayConnectionManager();
