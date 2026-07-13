// ═══════════════════════════════════════════════════════════
// GatewayConnectionManager — orchestrator layer.
// Combines state machine + action executor + event subscription.
// App.tsx calls manager.init() and subscribes to state changes.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import { GatewayStateMachine, type GatewayAction } from './GatewayStateMachine';
import { executeConnect, executeDockerStart, executeStart } from './GatewayActionExecutor';
import { LifecycleEpoch } from './LifecycleEpoch';
import { type GatewayEvent, type GatewayStateSnapshot } from './types';

type StateListener = (snapshot: GatewayStateSnapshot) => void;

export class GatewayConnectionManager {
  private fsm = new GatewayStateMachine();
  private listeners = new Set<StateListener>();
  private error: string | null = null;
  private retrying = false;
  private logs: { stdout: string; stderr: string } | undefined;
  private statusUnsub: (() => void) | undefined;
  private pendingStart: {
    promise: Promise<any>;
    resolve: (result: any) => void;
    reject: (error: Error) => void;
    generation: number;
  } | null = null;
  private readonly lifecycleEpoch = new LifecycleEpoch();

  /** Subscribe to state changes. Returns unsubscribe function. */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Initialize: subscribe to gateway status events + probe. */
  init(): void {
    this.rejectPendingStart('Gateway manager was reinitialized');
    const generation = this.lifecycleEpoch.activate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.dispatch({ type: 'INITIALIZE' });

    if (!window.aegis?.gateway) {
      this.dispatch({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
      return;
    }

    // Subscribe to real-time status updates
    this.statusUnsub = window.aegis.gateway.onStatusChanged((status: any) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        running: Boolean(status.running),
        error: status.error ?? null,
        retrying: Boolean(status.retrying),
        logs: status.logs,
      });
    });

    // onStatusChanged owns the initial probe as well as periodic updates. A
    // second getStatus() here used to race it and submit stale process state.
  }

  /** Notify that WebSocket has opened (called from App onStatusChange). */
  notifyWsOpen(): void {
    this.dispatch({ type: 'WS_OPEN' });
  }

  /** Notify that WebSocket has closed (called from App onStatusChange). */
  notifyWsClose(): void {
    this.dispatch({ type: 'WS_CLOSE' });
  }

  /** Manually trigger a retry from ERROR state. */
  retry(): void {
    this.beginRecovery('RETRY');
  }

  /** Reset to DETECTING (e.g. after config change). */
  reset(): void {
    this.invalidateLifecycle('Gateway lifecycle was reset');
    this.dispatch({ type: 'RESET' });
  }

  /**
   * Immediately probe gateway process status and drive the FSM from the result.
   * Use after reset() to avoid waiting up to 2s for the periodic poller to fire.
   */
  probe(): void {
    if (!window.aegis?.gateway) {
      this.dispatch({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
      return;
    }
    const generation = this.lifecycleEpoch.capture();
    void window.aegis.gateway.getStatus().then((status: any) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        running: Boolean(status.running),
        error: status.error ?? null,
        retrying: Boolean(status.retrying),
        logs: status.logs,
      });
    }).catch((error) => {
      if (!this.isCurrent(generation)) return;
      this.dispatch({
        type: 'STATUS_RECEIVED',
        running: false,
        error: String(error),
        retrying: false,
      });
    });
  }

  /** Reset FSM to DETECTING and immediately probe — active reconnect. */
  reconnect(): void {
    this.beginRecovery('RESET');
  }

  startForSetup(): Promise<any> {
    return this.requestSetupStart('START_REQUESTED');
  }

  startDockerForSetup(): Promise<any> {
    return this.requestSetupStart('DOCKER_START_REQUESTED');
  }

  private requestSetupStart(event: 'START_REQUESTED' | 'DOCKER_START_REQUESTED'): Promise<any> {
    if (this.pendingStart) return this.pendingStart.promise;
    if (!this.lifecycleEpoch.isActive()) {
      this.lifecycleEpoch.activate();
      this.dispatch({ type: 'INITIALIZE' });
    } else {
      this.invalidateLifecycle('A newer setup start superseded the previous lifecycle');
    }
    const generation = this.lifecycleEpoch.capture();
    let resolve!: (result: any) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<any>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    this.pendingStart = { promise, resolve, reject, generation };
    this.dispatch({ type: event });
    return promise;
  }

  async ensureRunning(): Promise<any> {
    if (!window.aegis?.gateway?.ensureRunning) {
      this.reconnect();
      return { healthy: true, mode: 'browser' };
    }
    const generation = this.beginProcessRecovery();
    let result: any;
    try {
      result = await window.aegis.gateway.ensureRunning();
    } catch (error) {
      result = { healthy: false, error: String(error) };
    }
    if (!this.isCurrent(generation)) return { ...result, superseded: true };
    if (result?.healthy) {
      this.reconnect();
    } else {
      this.dispatch({
        type: 'STATUS_RECEIVED',
        running: false,
        error: result?.error ?? 'Gateway recovery failed',
        retrying: false,
      });
    }
    return result;
  }

  async restart(): Promise<any> {
    if (!window.aegis?.gateway?.retry) {
      const result = { success: false, error: 'Gateway restart is unavailable in this runtime.' };
      this.dispatch({ type: 'STATUS_RECEIVED', running: false, error: result.error, retrying: false });
      return result;
    }
    const generation = this.beginProcessRecovery();
    let result: any;
    try {
      result = await window.aegis.gateway.retry();
    } catch (error) {
      result = { success: false, error: String(error) };
    }
    if (!this.isCurrent(generation)) return { ...result, superseded: true };
    if (result?.success === false) {
      this.dispatch({
        type: 'STATUS_RECEIVED',
        running: false,
        error: result.error ?? 'Gateway restart failed',
        retrying: false,
      });
      return result;
    }
    this.reconnect();
    return result;
  }

  reconnectWithToken(token: string): void {
    this.invalidateLifecycle('Gateway credentials changed');
    this.dispatch({ type: 'RESET' });
    gateway.reconnectWithToken(token);
  }

  connect(url: string, token: string): void {
    this.invalidateLifecycle('Gateway connection target changed');
    this.dispatch({ type: 'RESET' });
    gateway.connect(url, token);
  }

  /** Cleanup — call on unmount. */
  destroy(): void {
    this.lifecycleEpoch.deactivate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.rejectPendingStart('Gateway manager was destroyed');
    this.listeners.clear();
    gateway.disconnect();
  }

  // The single Gateway orchestration core: every fact and intent commits here.
  private dispatch(event: GatewayEvent): void {
    if (!this.lifecycleEpoch.isActive()) return;
    if (event.type === 'INITIALIZE') {
      this.logs = undefined;
      this.retrying = false;
      this.error = null;
    } else if (event.type === 'RECOVERY_REQUESTED') {
      this.retrying = true;
      this.error = null;
    } else if (event.type === 'STATUS_RECEIVED') {
      if (event.logs) this.logs = event.logs;
      this.retrying = event.retrying;
      this.error = event.error;
    } else if (event.type === 'START_FAILED') {
      this.error = event.error;
      this.retrying = false;
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

    // Execute actions returned by the FSM
    for (const action of result.actions) {
      this.executeAction(action, this.lifecycleEpoch.capture());
    }

    this.emit();
  }

  private executeAction(action: GatewayAction, generation: number): void {
    switch (action) {
      case 'CONNECT':
        void executeConnect((httpUrl) => {
          if (!this.isCurrent(generation)) return;
          // App.tsx uses this for media resolution / pairing
          window.dispatchEvent(new CustomEvent('aegis:gateway-http-url', { detail: httpUrl }));
        }, () => this.isCurrent(generation));
        break;
      case 'START':
        void executeStart().then((result) => this.completeStart(result, generation));
        break;
      case 'START_DOCKER':
        void executeDockerStart().then((result) => this.completeStart(result, generation));
        break;
      case 'SHOW_ERROR':
        // error already committed by dispatch
        break;
      case 'NONE':
        break;
    }
  }

  private snapshot(): GatewayStateSnapshot {
    return {
      ...this.fsm.snapshot(this.error, this.retrying),
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

  private beginRecovery(event: 'RESET' | 'RETRY'): void {
    this.invalidateLifecycle('A newer Gateway recovery was requested');
    this.dispatch({ type: event });
    gateway.disconnect();
    this.probe();
  }

  private completeStart(result: any, generation: number): void {
    if (!this.isCurrent(generation)) {
      if (this.pendingStart?.generation === generation) {
        this.rejectPendingStart('Gateway start was superseded by a newer lifecycle');
      }
      return;
    }
    if (result?.success) {
      this.dispatch({ type: 'START_SUCCESS' });
      this.pendingStart?.resolve(result);
    } else {
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
    this.lifecycleEpoch.invalidate();
  }

  private rejectPendingStart(reason: string): void {
    this.pendingStart?.reject(new Error(reason));
    this.pendingStart = null;
  }
}

/** Singleton — shared across the app. */
export const gatewayManager = new GatewayConnectionManager();
