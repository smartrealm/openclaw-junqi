// Gateway 连接领域类型：状态、事件与快照。

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

/** Gateway 连接生命周期的有限状态。 */
export enum GatewayState {
  DETECTING = 'detecting',     // 正在探测 Gateway
  STARTING = 'starting',       // 正在启动 Gateway 进程
  CONNECTING = 'connecting',   // 正在建立 WebSocket 连接
  CONNECTED = 'connected',     // WebSocket 已连接
  ERROR = 'error',             // 发生需要用户重试的错误
}

/** 驱动状态转换的事件。 */
export type GatewayEvent =
  | { type: 'INITIALIZE' }
  | { type: 'RECOVERY_REQUESTED' }
  | {
      type: 'STATUS_RECEIVED';
      processAlive: boolean;
      endpointReady: boolean;
      error: string | null;
      retrying: boolean;
      logs?: { stdout: string; stderr: string };
    }
  | { type: 'START_SUCCESS' }
  | { type: 'CONNECT_FAILED'; error: string }
  | { type: 'SELECTED_GATEWAY_READY' }
  | { type: 'START_FAILED'; error: string }
  | { type: 'START_REQUESTED' }
  | { type: 'DOCKER_START_REQUESTED' }
  | { type: 'WS_OPEN' }
  | { type: 'WS_CLOSE'; reason?: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

/** Rust Gateway 进程观测返回的外部状态。 */
export interface GatewayProcessStatus {
  running: boolean;
  processAlive?: boolean;
  ready?: boolean;
  error: string | null;
  retrying?: boolean;
  logs?: { stdout: string; stderr: string };
}

export interface GatewayStartResult {
  success: boolean;
  error?: string;
  port?: number;
  token?: string | null;
}

/** 从当前配置解析出的连接目标。 */
export interface ConnectionTarget {
  wsUrl: string;
  /** 从所选 OpenClaw 配置读取的显式共享令牌。 */
  token: string;
  /** 从操作系统凭据库读取的已配对设备令牌。 */
  deviceToken: string;
  httpUrl: string;
}

/** 发送给界面订阅者的状态快照。 */
export interface GatewayStateSnapshot {
  state: GatewayState;
  connecting: boolean;
  connected: boolean;
  error: string | null;
  logs?: { stdout: string; stderr: string };
  retrying: boolean;
  /** 所选状态与配置对应的端点已通过认证健康探测。 */
  selectedGatewayReady: boolean;
}
