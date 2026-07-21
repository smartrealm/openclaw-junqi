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
type IdentityResolver = (observation: GatewayHelloObservation) => Promise<RuntimeIdentity>;
type IdentityClearer = (params: ClearRuntimeIdentityParams) => Promise<boolean>;

let currentIdentity: RuntimeIdentity | null = null;
let activeConnectionId: string | null = null;
let observationGeneration = 0;
const listeners = new Set<IdentityListener>();

const stringValue = (value: unknown): string => typeof value === 'string' ? value : '';
const nullableString = (value: unknown): string | null => {
  const text = stringValue(value).trim();
  return text ? text : null;
};
const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string')
  : [];

/** Convert a hello-ok payload into the only shape accepted by Tauri attestation. */
export function buildGatewayHelloObservation(
  endpoint: string,
  response: unknown,
  observedAtMs = Date.now(),
): GatewayHelloObservation {
  const envelope = response && typeof response === 'object'
    ? response as Record<string, any>
    : {};
  const hello = envelope.payload?.type === 'hello-ok' ? envelope.payload : envelope;
  const server = hello.server && typeof hello.server === 'object' ? hello.server : {};
  const features = hello.features && typeof hello.features === 'object' ? hello.features : {};
  const snapshot = hello.snapshot && typeof hello.snapshot === 'object' ? hello.snapshot : {};
  const auth = hello.auth && typeof hello.auth === 'object' ? hello.auth : {};

  return {
    endpoint,
    protocol: Number.isInteger(hello.protocol) && hello.protocol >= 0 ? hello.protocol : 0,
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

/** Bind the durable plugin identity only to the socket that supplied it. */
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

function publish(identity: RuntimeIdentity | null): void {
  currentIdentity = identity;
  listeners.forEach((listener) => listener(identity));
}

/**
 * Resolve and cache one hello observation. The generation guard prevents a slow
 * response from an old socket from replacing the identity of a newer socket.
 */
export async function observeGatewayHello(
  observation: GatewayHelloObservation,
  resolver: IdentityResolver = resolveGatewayRuntimeIdentityCommand,
): Promise<RuntimeIdentity | null> {
  const generation = ++observationGeneration;
  activeConnectionId = observation.connectionId;
  const identity = await resolver(observation);
  if (
    generation !== observationGeneration
    || activeConnectionId !== observation.connectionId
    || identity.connectionId !== observation.connectionId
  ) {
    return null;
  }
  publish(identity);
  return identity;
}

/** Invalidate only the socket that closed; an old close cannot clear a new one. */
export async function invalidateGatewayRuntimeIdentity(
  connectionId: string,
  clearer: IdentityClearer = clearGatewayRuntimeIdentityCommand,
): Promise<boolean> {
  const wasActive = Boolean(connectionId) && activeConnectionId === connectionId;
  if (wasActive) {
    observationGeneration += 1;
    activeConnectionId = null;
    publish(null);
  }
  return clearer({ connectionId });
}
