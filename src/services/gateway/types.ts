// ═══════════════════════════════════════════════════════════
// Gateway connection types — state, events, status
// ═══════════════════════════════════════════════════════════

export type {
  GatewayHelloObservation,
  RuntimeAttestation,
  RuntimeDeploymentKind,
  RuntimeIdentity,
  RuntimeIdentityIssue,
  RuntimeInstallTarget,
  RuntimeOwnership,
  RuntimePersistence,
} from '@/types/gatewayRuntime';

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
  | { type: 'INITIALIZE' }
  | { type: 'RECOVERY_REQUESTED' }
  | {
      type: 'STATUS_RECEIVED';
      /** Backward-compatible status projection for older adapters. */
      running?: boolean;
      processAlive?: boolean;
      endpointReady?: boolean;
      error: string | null;
      retrying: boolean;
      logs?: { stdout: string; stderr: string };
    }
  | { type: 'START_SUCCESS' }
  | { type: 'SELECTED_GATEWAY_READY' }
  | { type: 'START_FAILED'; error: string }
  | { type: 'START_REQUESTED' }
  | { type: 'DOCKER_START_REQUESTED' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_CLOSE'; reason?: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

/** External gateway process status (from Rust gateway_status command). */
export interface GatewayProcessStatus {
  processAlive: boolean;
  ready: boolean;
  error: string | null;
  logs?: { stdout: string; stderr: string };
}

/** Connection target resolved from config. */
export interface ConnectionTarget {
  wsUrl: string;
  /** Explicit/shared token read from the selected OpenClaw configuration. */
  token: string;
  /** Paired-device token loaded from the operating-system credential vault. */
  deviceToken: string;
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
  /** The selected state/config pair has an authenticated, healthy endpoint. */
  selectedGatewayReady: boolean;
}
