export type RuntimeDeploymentKind =
  | 'external'
  | 'system_service'
  | 'managed_child'
  | 'docker';

export type RuntimeOwnership = 'junqi_managed' | 'user_managed' | 'remote';
export type RuntimePersistence = 'desktop_independent' | 'desktop_bound' | 'unknown';
export type RuntimeInstallTarget = 'native_cli' | 'docker_exec' | 'remote_manual';
export type RuntimeAttestation = 'matched' | 'mismatched' | 'unavailable' | 'not_applicable';

export type RuntimeIdentityIssue =
  | 'invalid_endpoint'
  | 'missing_connection_id'
  | 'missing_server_version'
  | 'invalid_protocol'
  | 'endpoint_mismatch'
  | 'missing_runtime_paths'
  | 'runtime_path_mismatch';

export interface GatewayHelloObservation {
  endpoint: string;
  protocol: number;
  serverVersion: string;
  connectionId: string;
  stateDir: string | null;
  configPath: string | null;
  authMode: string | null;
  methods: string[];
  events: string[];
  negotiatedRole: string | null;
  negotiatedScopes: string[];
  observedAtMs: number;
}

export interface RuntimeIdentity {
  /** Durable collaboration-plugin id. Null until that plugin is available. */
  runtimeId: string | null;
  /** Stable target key used before a durable plugin id exists. */
  targetFingerprint: string;
  connectionId: string;
  endpoint: string;
  gatewayVersion: string;
  protocol: number;
  stateDir: string | null;
  configPath: string | null;
  localStateDir: string;
  localConfigPath: string;
  deploymentKind: RuntimeDeploymentKind;
  ownership: RuntimeOwnership;
  persistence: RuntimePersistence;
  installTarget: RuntimeInstallTarget;
  endpointAttestation: RuntimeAttestation;
  pathAttestation: RuntimeAttestation;
  desktopMutationAllowed: boolean;
  desktopExitContinuity: boolean;
  verified: boolean;
  issues: RuntimeIdentityIssue[];
  authMode: string | null;
  methods: string[];
  events: string[];
  negotiatedRole: string | null;
  negotiatedScopes: string[];
  supervisorLifecycle: 'stopped' | 'starting' | 'running' | 'error' | 'reconnecting';
  supervisorPort: number;
  observedAtMs: number;
}

export interface ClearRuntimeIdentityParams {
  connectionId: string;
}
