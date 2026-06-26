// ═══════════════════════════════════════════════════════════
// GatewayConnectionManager — orchestrator layer.
// Combines state machine + action executor + event subscription.
// App.tsx calls manager.init() and subscribes to state changes.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import { GatewayStateMachine, type GatewayAction } from './GatewayStateMachine';
import { executeConnect, executeStart } from './GatewayActionExecutor';
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

  /** Subscribe to state changes. Returns unsubscribe function. */
  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  /** Initialize: subscribe to gateway status events + probe. */
  init(): void {
    if (!window.aegis?.gateway) {
      this.handleEvent({ type: 'STATUS_RECEIVED', running: true, error: null, retrying: false });
      return;
    }

    // Subscribe to real-time status updates
    this.statusUnsub = window.aegis.gateway.onStatusChanged((status: any) => {
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

    // Initial probe
    void window.aegis.gateway.getStatus().then((status: any) => {
      if (status.logs) this.logs = status.logs;
      this.handleEvent({
        type: 'STATUS_RECEIVED',
        running: Boolean(status.running),
        error: status.error ?? null,
        retrying: false,
      });
    });
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
    this.startAttempted = false;
    this.handleEvent({ type: 'RESET' });
  }

  /** Cleanup — call on unmount. */
  destroy(): void {
    this.statusUnsub?.();
    this.listeners.clear();
    gateway.disconnect();
  }

  // ── Core: process event through FSM, execute actions ──
  private handleEvent(event: GatewayEvent): void {
    // Special handling: STATUS_RECEIVED with error updates error state
    if (event.type === 'STATUS_RECEIVED' && event.error) {
      this.error = event.error;
    }

    const result = this.fsm.transition(event);

    // Execute actions returned by the FSM
    for (const action of result.actions) {
      this.executeAction(action);
    }

    this.emit();
  }

  private executeAction(action: GatewayAction): void {
    switch (action) {
      case 'CONNECT':
        void executeConnect((httpUrl) => {
          // App.tsx uses this for media resolution / pairing
          window.dispatchEvent(new CustomEvent('aegis:gateway-http-url', { detail: httpUrl }));
        });
        break;
      case 'START':
        if (!this.startAttempted) {
          this.startAttempted = true;
          void executeStart().then((result) => {
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
    return this.fsm.snapshot(this.error, this.retrying);
  }

  private emit(): void {
    const snap = this.snapshot();
    this.listeners.forEach(l => l(snap));
  }
}

/** Singleton — shared across the app. */
export const gatewayManager = new GatewayConnectionManager();
