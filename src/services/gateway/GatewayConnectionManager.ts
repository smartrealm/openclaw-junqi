// ═══════════════════════════════════════════════════════════
// GatewayConnectionManager — orchestrator layer.
// Combines state machine + action executor + event subscription.
// App.tsx calls manager.init() and subscribes to state changes.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import { GatewayStateMachine, type GatewayAction } from './GatewayStateMachine';
import { executeConnect, executeStart } from './GatewayActionExecutor';
import { LifecycleEpoch } from './LifecycleEpoch';
import {
  GatewayState,
  type GatewayEvent,
  type GatewayStateSnapshot,
  type GatewayProcessStatus,
} from './types';

type StateListener = (snapshot: GatewayStateSnapshot) => void;

export class GatewayConnectionManager {
  private fsm = new GatewayStateMachine();
  private listeners = new Set<StateListener>();
  private error: string | null = null;
  private retrying = false;
  private logs: { stdout: string; stderr: string } | undefined;
  private statusUnsub: (() => void) | undefined;
  private startAttempted = false;
  private readonly lifecycleEpoch = new LifecycleEpoch();

  /** Subscribe to state changes. Returns unsubscribe function. */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Initialize: subscribe to gateway status events + probe. */
  init(): void {
    const generation = this.lifecycleEpoch.activate();
    this.fsm = new GatewayStateMachine();
    this.startAttempted = false;
    this.retrying = false;
    this.error = null;
    this.statusUnsub?.();
    this.statusUnsub = undefined;

    if (!window.aegis?.gateway) {
      this.handleEvent({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
      return;
    }

    // Subscribe to real-time status updates
    this.statusUnsub = window.aegis.gateway.onStatusChanged((status: any) => {
      if (!this.isCurrent(generation)) return;
      if (status.logs) this.logs = status.logs;
      if (status.retrying) { this.retrying = true; this.emit(); return; }
      this.retrying = false;

      this.handleEvent({
        type: 'STATUS_RECEIVED',
        running: Boolean(status.running),
        error: status.error ?? null,
        retrying: false,
      });
    });

    // onStatusChanged owns the initial probe as well as periodic updates. A
    // second getStatus() here used to race it and submit stale process state.
  }

  /** Notify that WebSocket has opened (called from App onStatusChange). */
  notifyWsOpen(): void {
    this.handleEvent({ type: 'WS_OPEN' });
  }

  /** Notify that WebSocket has closed (called from App onStatusChange). */
  notifyWsClose(): void {
    this.handleEvent({ type: 'WS_CLOSE' });
  }

  /** Manually trigger a retry from ERROR state. */
  retry(): void {
    this.error = null;
    this.handleEvent({ type: 'RETRY' });
  }

  /** Reset to DETECTING (e.g. after config change). */
  reset(): void {
    this.lifecycleEpoch.invalidate();
    this.startAttempted = false;
    this.retrying = false;
    this.error = null;
    this.handleEvent({ type: 'RESET' });
  }

  /**
   * Immediately probe gateway process status and drive the FSM from the result.
   * Use after reset() to avoid waiting up to 2s for the periodic poller to fire.
   */
  probe(): void {
    if (!window.aegis?.gateway) {
      this.handleEvent({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
      return;
    }
    const generation = this.lifecycleEpoch.capture();
    void window.aegis.gateway.getStatus().then((status: any) => {
      if (!this.isCurrent(generation)) return;
      if (status.logs) this.logs = status.logs;
      this.handleEvent({
        type: 'STATUS_RECEIVED',
        running: Boolean(status.running),
        error: status.error ?? null,
        retrying: false,
      });
    });
  }

  /** Reset FSM to DETECTING and immediately probe — active reconnect. */
  reconnect(): void {
    this.lifecycleEpoch.invalidate();
    this.startAttempted = false;
    this.retrying = false;
    this.error = null;
    this.handleEvent({ type: 'RESET' });
    this.probe();
  }

  /** Cleanup — call on unmount. */
  destroy(): void {
    this.lifecycleEpoch.deactivate();
    this.statusUnsub?.();
    this.statusUnsub = undefined;
    this.listeners.clear();
    gateway.disconnect();
  }

  // ── Core: process event through FSM, execute actions ──
  private handleEvent(event: GatewayEvent): void {
    if (!this.lifecycleEpoch.isActive()) return;
    // Special handling: STATUS_RECEIVED with error updates error state
    if (event.type === 'STATUS_RECEIVED' && event.error) {
      this.error = event.error;
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
        if (!this.startAttempted) {
          this.startAttempted = true;
          void executeStart().then((result) => {
            if (!this.isCurrent(generation)) return;
            if (result.success) {
              this.handleEvent({ type: 'START_SUCCESS' });
            } else {
              this.error = result.error || 'Failed to start gateway';
              this.handleEvent({ type: 'START_FAILED', error: this.error! });
            }
          });
        }
        break;
      case 'CLEAR_ERROR':
        this.error = null;
        break;
      case 'SHOW_ERROR':
        // error already set in handleEvent
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
}

/** Singleton — shared across the app. */
export const gatewayManager = new GatewayConnectionManager();
