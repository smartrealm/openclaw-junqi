import {
  clearGatewayRuntimeIdentity as clearGatewayRuntimeIdentityCommand,
  resolveGatewayRuntimeIdentity as resolveGatewayRuntimeIdentityCommand,
} from '@/api/tauri-commands';
import type {
  ClearRuntimeIdentityParams,
  GatewayHelloObservation,
  RuntimeIdentity,
} from '@/types/gatewayRuntime';

type IdentityListener = (identity: RuntimeIdentity | null) => void;
export interface RuntimeIdentityAttestationFailure {
  connectionId: string;
  diagnostic: string;
}
type IdentityFailureListener = (failure: RuntimeIdentityAttestationFailure | null) => void;
type IdentityResolver = (observation: GatewayHelloObservation) => Promise<RuntimeIdentity>;
type IdentityClearer = (params: ClearRuntimeIdentityParams) => Promise<boolean>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

let currentIdentity: RuntimeIdentity | null = null;
let currentFailure: RuntimeIdentityAttestationFailure | null = null;
let activeConnectionId: string | null = null;
let observationGeneration = 0;
const listeners = new Set<IdentityListener>();
const failureListeners = new Set<IdentityFailureListener>();

const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';
const nullableString = (value: unknown): string | null => {
  const text = stringValue(value).trim();
  return text ? text : null;
};
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];

/** 将 hello-ok 投影为 Tauri 运行时身份核验接受的唯一结构。 */
export function buildGatewayHelloObservation(
  endpoint: string,
  response: unknown,
  observedAtMs = Date.now(),
): GatewayHelloObservation {
  const envelope = isRecord(response) ? response : {};
  const payload = isRecord(envelope.payload) ? envelope.payload : null;
  const hello = payload?.type === 'hello-ok' ? payload : envelope;
  const server = isRecord(hello.server) ? hello.server : {};
  const features = isRecord(hello.features) ? hello.features : {};
  const snapshot = isRecord(hello.snapshot) ? hello.snapshot : {};
  const auth = isRecord(hello.auth) ? hello.auth : {};
  const protocol = hello.protocol;

  return {
    endpoint,
    protocol: typeof protocol === 'number' && Number.isInteger(protocol) && protocol >= 0 ? protocol : 0,
    serverVersion: stringValue(server.version),
    connectionId: stringValue(server.connId),
    stateDir: nullableString(snapshot.stateDir),
    configPath: nullableString(snapshot.configPath),
    authMode: nullableString(snapshot.authMode),
    methods: stringArray(features.methods),
    events: stringArray(features.events),
    negotiatedRole: nullableString(auth.role),
    negotiatedScopes: stringArray(auth.scopes),
    observedAtMs,
  };
}

export function getCurrentRuntimeIdentity(): RuntimeIdentity | null {
  return currentIdentity;
}

export function getCurrentRuntimeIdentityFailure(): RuntimeIdentityAttestationFailure | null {
  return currentFailure;
}

/** 只允许为提供身份依据的当前连接绑定持久插件身份。 */
export function bindCollaborationRuntimeIdentity(
  collaborationInstanceId: string,
  expectedConnectionId: string,
): RuntimeIdentity | null {
  const instanceId = collaborationInstanceId.trim();
  if (
    !instanceId
    || !currentIdentity
    || !expectedConnectionId
    || currentIdentity.connectionId !== expectedConnectionId
    || activeConnectionId !== expectedConnectionId
  ) {
    return null;
  }
  if (currentIdentity.runtimeId === instanceId) return currentIdentity;
  const identity = { ...currentIdentity, runtimeId: instanceId };
  publish(identity);
  return identity;
}

export function subscribeRuntimeIdentity(listener: IdentityListener): () => void {
  listeners.add(listener);
  listener(currentIdentity);
  return () => listeners.delete(listener);
}

export function subscribeRuntimeIdentityFailure(listener: IdentityFailureListener): () => void {
  failureListeners.add(listener);
  listener(currentFailure);
  return () => failureListeners.delete(listener);
}

function publish(identity: RuntimeIdentity | null): void {
  currentIdentity = identity;
  listeners.forEach((listener) => listener(identity));
}

function publishFailure(failure: RuntimeIdentityAttestationFailure | null): void {
  currentFailure = failure;
  failureListeners.forEach((listener) => listener(failure));
}

function failureDiagnostic(error: unknown): string {
  const diagnostic = error instanceof Error ? error.message : String(error);
  return diagnostic.trim() || 'Gateway runtime identity attestation failed';
}

/**
 * 解析并缓存一条 hello 观测。代次围栏会阻止旧连接的迟到结果覆盖新连接身份，
 * 同时把当前连接的核验失败作为结构化终态交给生命周期协调器。
 */
export async function observeGatewayHello(
  observation: GatewayHelloObservation,
  resolver: IdentityResolver = resolveGatewayRuntimeIdentityCommand,
): Promise<RuntimeIdentity | null> {
  const generation = ++observationGeneration;
  activeConnectionId = observation.connectionId;
  publish(null);
  publishFailure(null);
  let identity: RuntimeIdentity;
  try {
    identity = await resolver(observation);
  } catch (error) {
    if (
      generation === observationGeneration
      && activeConnectionId === observation.connectionId
    ) {
      publishFailure({
        connectionId: observation.connectionId,
        diagnostic: failureDiagnostic(error),
      });
    }
    throw error;
  }
  if (
    generation !== observationGeneration
    || activeConnectionId !== observation.connectionId
    || identity.connectionId !== observation.connectionId
  ) {
    return null;
  }
  publishFailure(null);
  publish(identity);
  return identity;
}

/** 只失效已关闭的连接；旧连接的关闭事件不能清理新连接身份。 */
export async function invalidateGatewayRuntimeIdentity(
  connectionId: string,
  clearer: IdentityClearer = clearGatewayRuntimeIdentityCommand,
): Promise<boolean> {
  const wasActive = Boolean(connectionId) && activeConnectionId === connectionId;
  if (wasActive) {
    observationGeneration += 1;
    activeConnectionId = null;
    publish(null);
    publishFailure(null);
  }
  return clearer({ connectionId });
}
