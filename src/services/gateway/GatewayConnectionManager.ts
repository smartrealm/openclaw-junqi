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
import type { GatewayRetryState } from './Connection';
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
  stopPairingRetry?(): void;
  subscribeRetryState?(listener: (state: GatewayRetryState) => void): () => void;
}

type GatewayConnectionRound = 'inactive' | 'waiting-endpoint' | 'transport-owned' | 'exhausted';

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
  stopPairingRetry: () => gateway.stopPairingRetry(),
  subscribeRetryState: (listener) => gateway.subscribeRetryState(listener),
};

export class GatewayConnectionManager {
  private fsm = new GatewayStateMachine();
  private listeners = new Set<StateListener>();
  private error: string | null = null;
  private retrying = false;
  private selectedGatewayReady = false;
  private connectionAttemptError: string | null = null;
  private logs: { stdout: string; stderr: string } | undefined;
  private statusUnsub: (() => void) | undefined;
  private directStatusUnsub: (() => void) | undefined;
  private transportRetryUnsub: (() => void) | undefined;
  private persistentObservation = false;
  private directLifecycleOwned = false;
  private pendingStart: {
    promise: Promise<GatewayStartResult>;
    resolve: (result: GatewayStartResult) => void;
    reject: (error: Error) => void;
    generation: number;
  } | null = null;
  private useSelectedRuntimeForNextConnection = false;
  private connectionRound: GatewayConnectionRound = 'inactive';
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
    this.persistentObservation = true;
    this.stopDirectProcessObservation();
    this.directLifecycleOwned = false;
    const generation = this.lifecycleEpoch.activate();
    this.connectionRound = 'waiting-endpoint';
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.dispatch({ type: 'INITIALIZE' });
    // 先清理上一轮管理器状态，再消费 Connection 的可回放终态，避免 INITIALIZE
    // 把已经耗尽的权威诊断覆盖成无错误的探测状态。
    this.startTransportRetryObservation();

    this.statusUnsub = this.subscribeProcessStatus(generation);
  }

  /** 接收 App 转发的 WebSocket 已连接事实。 */
  notifyWsOpen(): void {
    this.connectionRound = 'transport-owned';
    this.dispatch({ type: 'WS_OPEN' });
  }

  /** 接收 App 转发的 WebSocket 已断开事实。 */
  notifyWsClose(): void {
    if (this.connectionRound === 'transport-owned') {
      this.dispatchConnectionRetrying();
      return;
    }
    if (this.connectionRound !== 'exhausted') this.dispatch({ type: 'WS_CLOSE' });
  }

  /** 从错误状态触发一次重试。 */
  retry(): void {
    this.beginRecovery('RETRY');
  }

  /** 配置变化后重置为探测状态。 */
  reset(): void {
    this.activateForDirectRecovery();
    this.invalidateLifecycle('Gateway lifecycle was reset');
    this.connectionRound = 'inactive';
    this.dispatch({ type: 'RESET' });
    this.refreshProcessObservation();
    this.connectionTransport.disconnect();
    this.connectionRound = 'waiting-endpoint';
    this.probe();
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
    this.beginRecovery('RESET');
  }

  /** 首次配置交接时重新读取当前所选运行时的端点和凭据。 */
  reconnectSelectedRuntime(): void {
    this.beginRecovery('RESET', true);
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
    this.connectionRound = 'inactive';
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
      this.reconnectSelectedRuntime();
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
      // 原生重启一旦开始就必须在进程操作锁内收敛；前端截止时间只能阻止后续重连与完成发布。
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
    this.activateForDirectRecovery();
    this.invalidateLifecycle('Gateway credentials changed');
    this.connectionRound = 'inactive';
    this.dispatch({ type: 'RESET' });
    this.refreshProcessObservation();
    // 直接传输入口本身就是本轮唯一连接意图，不能再由健康轮询创建第二次 CONNECT。
    this.connectionRound = 'transport-owned';
    this.connectionTransport.reconnectWithToken(token);
  }

  connect(url: string, token: string, deviceToken = ''): void {
    this.activateForDirectRecovery();
    this.invalidateLifecycle('Gateway connection target changed');
    this.connectionRound = 'inactive';
    this.dispatch({ type: 'RESET' });
    this.refreshProcessObservation();
    // 显式连接必须先结束当前传输轮次。同目标且已连接时，底层连接会把重复
    // connect 视为无操作；若管理器已经重置，便会造成界面停在探测状态。
    this.connectionTransport.disconnect();
    // 直接传输入口本身就是本轮唯一连接意图，不能再由健康轮询创建第二次 CONNECT。
    this.connectionRound = 'transport-owned';
    this.connectionTransport.connect(url, token, deviceToken);
  }

  /** 取消当前配对等待，并由统一连接编排层收敛传输与界面状态。 */
  cancelPairing(): void {
    // 只有底层普通连接确实处于配对等待时才会发布 idle；特权临时连接的
    // 配对取消由各自授权控制器处理，不能因此重置仍然健康的主连接。
    this.connectionTransport.stopPairingRetry?.();
  }

  /** 卸载时清理状态订阅与连接。 */
  destroy(): void {
    this.persistentObservation = false;
    this.directLifecycleOwned = false;
    this.connectionRound = 'inactive';
    this.lifecycleEpoch.deactivate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.stopDirectProcessObservation();
    this.stopTransportRetryObservation();
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
      this.connectionAttemptError = null;
    } else if (event.type === 'RECOVERY_REQUESTED') {
      this.retrying = true;
      this.error = null;
      this.selectedGatewayReady = false;
    } else if (event.type === 'STATUS_RECEIVED') {
      if (event.logs) this.logs = event.logs;
      this.retrying = event.retrying;
      // 进程健康轮询不能清除 Connection 已发布的权威耗尽终态。
      if (this.connectionRound !== 'exhausted') this.error = event.error;
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
      this.connectionAttemptError = event.error;
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
      this.connectionAttemptError = null;
      this.retrying = false;
    }

    const result = this.fsm.transition(event, {
      allowConnect: event.type === 'STATUS_RECEIVED'
        ? this.connectionRound === 'waiting-endpoint'
        : undefined,
    });

    // 执行状态机返回的副作用动作。
    for (const action of result.actions) {
      this.executeAction(action, this.lifecycleEpoch.capture());
    }

    this.emit();
  }

  private executeAction(action: GatewayAction, generation: number): void {
    switch (action) {
      case 'CONNECT': {
        // 健康端点只消费一次显式连接意图，后续退避完全由 Connection 持有。
        this.connectionRound = 'transport-owned';
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
          this.connectionRound = 'exhausted';
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
      connectionAttemptError: this.connectionAttemptError,
    };
  }

  /** 为连接收敛层暴露当前状态事实，不允许调用方直接修改状态机。 */
  getStateSnapshot(): GatewayStateSnapshot {
    return this.snapshot();
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
    if (!this.lifecycleEpoch.isActive()) {
      this.lifecycleEpoch.activate();
      this.directLifecycleOwned = true;
      this.connectionRound = 'waiting-endpoint';
      this.dispatch({ type: 'INITIALIZE' });
      this.startTransportRetryObservation();
    }
  }

  private beginRecovery(event: 'RESET' | 'RETRY', selectedRuntime = false): void {
    this.activateForDirectRecovery();
    this.invalidateLifecycle('A newer Gateway recovery was requested');
    this.connectionRound = 'inactive';
    this.useSelectedRuntimeForNextConnection = selectedRuntime;
    this.dispatch({ type: event });
    this.refreshProcessObservation();
    this.connectionTransport.disconnect();
    this.connectionRound = 'waiting-endpoint';
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
      this.connectionRound = 'waiting-endpoint';
      this.dispatch({ type: 'SELECTED_GATEWAY_READY' });
      this.dispatch({ type: 'START_SUCCESS' });
      this.pendingStart?.resolve(result);
    } else {
      this.useSelectedRuntimeForNextConnection = false;
      this.connectionRound = 'exhausted';
      this.connectionTransport.disconnect();
      const error = result?.error || 'Failed to start gateway';
      this.dispatch({ type: 'START_FAILED', error });
      this.pendingStart?.reject(new Error(error));
    }
    this.pendingStart = null;
  }

  private beginProcessRecovery(): number {
    this.activateForDirectRecovery();
    this.invalidateLifecycle('A newer Gateway process recovery was requested');
    this.connectionRound = 'inactive';
    this.connectionTransport.disconnect();
    this.dispatch({ type: 'RECOVERY_REQUESTED' });
    return this.lifecycleEpoch.capture();
  }

  /**
   * 首次设置页尚未挂载 App 的常驻观察器。生命周期事务结束后释放临时观察，
   * 但保留已经建立的认证连接交给工作台接管。
   */
  finishDirectRecovery(): void {
    this.stopDirectProcessObservation();
    if (this.directLifecycleOwned && !this.persistentObservation) {
      this.lifecycleEpoch.deactivate();
      this.stopTransportRetryObservation();
    }
    this.directLifecycleOwned = false;
  }

  private subscribeProcessStatus(generation: number): () => void {
    return this.processRuntime.subscribe((status) => {
      if (!this.isCurrent(generation)) return;
      this.commitProcessStatus(status);
    });
  }

  private commitProcessStatus(status: GatewayProcessRuntimeStatus): void {
    this.dispatch({
      type: 'STATUS_RECEIVED',
      processAlive: Boolean(status.processAlive ?? status.running),
      endpointReady: Boolean(status.ready),
      error: status.error ?? null,
      retrying: Boolean(status.retrying),
      logs: status.logs,
    });
  }

  private startDirectProcessObservation(): void {
    if (this.persistentObservation) return;
    this.stopDirectProcessObservation();
    this.directStatusUnsub = this.subscribeProcessStatus(this.lifecycleEpoch.capture());
  }

  private refreshProcessObservation(): void {
    if (this.persistentObservation) {
      this.statusUnsub?.();
      this.statusUnsub = this.subscribeProcessStatus(this.lifecycleEpoch.capture());
      return;
    }
    this.startDirectProcessObservation();
  }

  private stopDirectProcessObservation(): void {
    this.directStatusUnsub?.();
    this.directStatusUnsub = undefined;
  }

  private startTransportRetryObservation(): void {
    this.stopTransportRetryObservation();
    this.transportRetryUnsub = this.connectionTransport.subscribeRetryState?.((state) => {
      if (!this.lifecycleEpoch.isActive()) return;
      if (state.phase === 'attempting' || state.phase === 'backoff') {
        this.connectionRound = 'transport-owned';
        this.dispatchConnectionRetrying();
        return;
      }
      if (state.phase === 'connected') {
        this.connectionRound = 'transport-owned';
        return;
      }
      if (state.phase === 'idle' && this.connectionRound === 'transport-owned') {
        this.connectionRound = 'inactive';
        this.dispatch({ type: 'RESET' });
        return;
      }
      if (state.phase === 'exhausted') {
        this.connectionRound = 'exhausted';
        this.dispatch({
          type: 'CONNECT_FAILED',
          error: state.error || 'Gateway connection attempts exhausted',
        });
      }
    }) ?? undefined;
  }

  private stopTransportRetryObservation(): void {
    this.transportRetryUnsub?.();
    this.transportRetryUnsub = undefined;
  }

  private dispatchConnectionRetrying(): void {
    if (!this.lifecycleEpoch.isActive()) return;
    this.retrying = true;
    this.error = null;
    this.fsm.markConnectionRetrying();
    this.emit();
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
