// ═══════════════════════════════════════════════════════════
// GatewayStateMachine — pure state transitions, no side effects.
// Given (currentState, event) → (nextState, actionsToExecute).
// ═══════════════════════════════════════════════════════════

import { GatewayState, GatewayEvent, type GatewayStateSnapshot } from './types';

/** Actions the executor should perform after a transition. */
export type GatewayAction =
  | 'CONNECT'    // Establish WebSocket connection
  | 'START'      // Start gateway process
  | 'START_DOCKER'
  | 'SHOW_ERROR'
  | 'NONE';

export interface TransitionResult {
  state: GatewayState;
  actions: GatewayAction[];
}

interface TransitionRule {
  from: GatewayState;
  event: string;
  to: GatewayState;
  actions: GatewayAction[];
}

/**
 * Declarative transition table.
 * To add a new state/event, just add a row — no if-else chains.
 */
const RULES: TransitionRule[] = [
  // ── DETECTING ──
  { from: GatewayState.DETECTING, event: 'STATUS_RECEIVED', to: GatewayState.CONNECTING,  actions: ['CONNECT'] },
  { from: GatewayState.DETECTING, event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },
  // Note: running=false or error handled dynamically in transition()

  // ── STARTING ──
  { from: GatewayState.STARTING,  event: 'START_SUCCESS',   to: GatewayState.CONNECTING,  actions: ['CONNECT'] },
  { from: GatewayState.STARTING,  event: 'START_FAILED',    to: GatewayState.ERROR,       actions: ['SHOW_ERROR'] },
  { from: GatewayState.STARTING,  event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },

  // ── CONNECTING ──
  { from: GatewayState.CONNECTING, event: 'WS_OPEN',         to: GatewayState.CONNECTED,   actions: [] },
  { from: GatewayState.CONNECTING, event: 'WS_CLOSE',        to: GatewayState.DETECTING,   actions: [] },

  // ── CONNECTED ──
  { from: GatewayState.CONNECTED,  event: 'WS_CLOSE',        to: GatewayState.DETECTING,   actions: [] },

  // ── ERROR ──
  { from: GatewayState.ERROR,      event: 'RETRY',           to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.ERROR,      event: 'RESET',           to: GatewayState.DETECTING,   actions: [] },

  // ── Global: RESET always returns to DETECTING ──
  { from: GatewayState.DETECTING,   event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.STARTING,    event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTING,  event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTED,   event: 'RESET',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.DETECTING,   event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.STARTING,    event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTING,  event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
  { from: GatewayState.CONNECTED,   event: 'RETRY',          to: GatewayState.DETECTING,   actions: [] },
];

export class GatewayStateMachine {
  private state: GatewayState = GatewayState.DETECTING;

  get current(): GatewayState {
    return this.state;
  }

  /** Process an event; returns the transition result or null if no rule. */
  transition(event: GatewayEvent): TransitionResult {
    if (event.type === 'INITIALIZE' || event.type === 'RECOVERY_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.DETECTING, []);
    }
    if (event.type === 'START_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.STARTING, ['START']);
    }
    if (event.type === 'DOCKER_START_REQUESTED') {
      return this.apply(this.state, event.type, GatewayState.STARTING, ['START_DOCKER']);
    }

    // Process liveness, HTTP readiness, and WebSocket connectivity are distinct.
    // Status observation never starts a process: setup, boot recovery, and manual
    // recovery own that intent explicitly. This prevents a slow Gateway boot from
    // being interpreted as repeated permission to spawn another Gateway.
    if (event.type === 'STATUS_RECEIVED') {
      const processAlive = event.processAlive ?? event.running ?? false;
      const endpointReady = event.endpointReady ?? processAlive;
      if (event.retrying) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.DETECTING, []);
      }
      if (event.error) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.ERROR, ['SHOW_ERROR']);
      }
      if (!processAlive) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.DETECTING, []);
      }
      if (!endpointReady) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.STARTING, []);
      }
      if (this.state === GatewayState.CONNECTED || this.state === GatewayState.CONNECTING) {
        return { state: this.state, actions: ['NONE'] };
      }
      if (endpointReady) {
        return this.apply(this.state, 'STATUS_RECEIVED', GatewayState.CONNECTING, ['CONNECT']);
      }
    }

    // Static rule lookup
    const rule = RULES.find(r => r.from === this.state && r.event === event.type);
    if (!rule) return { state: this.state, actions: ['NONE'] };
    return this.apply(rule.from, rule.event, rule.to, rule.actions);
  }

  private apply(from: GatewayState, _event: string, to: GatewayState, actions: GatewayAction[]): TransitionResult {
    this.state = to;
    return { state: to, actions };
  }

  /** Build a UI-facing snapshot of the current state. */
  snapshot(
    error: string | null,
    retrying: boolean,
    selectedGatewayReady = false,
  ): GatewayStateSnapshot {
    return {
      state: this.state,
      connecting: this.state === GatewayState.CONNECTING || this.state === GatewayState.STARTING,
      connected: this.state === GatewayState.CONNECTED,
      error,
      retrying,
      selectedGatewayReady,
    };
  }
}
