// ═══════════════════════════════════════════════════════════
// Gateway connection types — state, events, status
// ═══════════════════════════════════════════════════════════

/** Finite states for the gateway connection lifecycle. */
export enum GatewayState {
  DETECTING = 'detecting',     // Probing if gateway is running
  STARTING = 'starting',       // Starting gateway process
  CONNECTING = 'connecting',   // WebSocket connecting
  CONNECTED = 'connected',     // WebSocket established
  ERROR = 'error',             // Fatal error, needs retry
}

/** Events that drive state transitions. */
export type GatewayEvent =
  | {
      type: 'STATUS_RECEIVED';
      running: boolean;
      error: string | null;
      retrying: boolean;
      logs?: { stdout: string; stderr: string };
    }
  | { type: 'START_SUCCESS' }
  | { type: 'START_FAILED'; error: string }
  | { type: 'START_REQUESTED' }
  | { type: 'DOCKER_START_REQUESTED' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_CLOSE'; reason?: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

/** External gateway process status (from Rust gateway_status command). */
export interface GatewayProcessStatus {
  running: boolean;
  ready: boolean;
  error: string | null;
  logs?: { stdout: string; stderr: string };
}

/** Connection target resolved from config. */
export interface ConnectionTarget {
  wsUrl: string;
  token: string;
  httpUrl: string;
}

/** State snapshot emitted to UI listeners. */
export interface GatewayStateSnapshot {
  state: GatewayState;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  logs?: { stdout: string; stderr: string };
  retrying: boolean;
}
