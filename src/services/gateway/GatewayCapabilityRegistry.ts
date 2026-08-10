import { classifyGatewayAuthorizationError } from './messageRouter';
import {
  GatewayRequestTimeoutError,
  isGatewayTransportLifecycleError,
} from './GatewayTransportError';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import type { GatewayHelloObservation } from '@/types/gatewayRuntime';

export type GatewayCapabilityState =
  | 'advertised'
  | 'available'
  | 'unsupported'
  | 'unauthorized'
  | 'unavailable'
  | 'invalid_response'
  | 'pending_verification'
  | 'error';

export type GatewayCapabilityEvidenceSource = 'hello' | 'rpc';

export interface GatewayCapabilityEvidence {
  method: string;
  state: GatewayCapabilityState;
  source: GatewayCapabilityEvidenceSource;
  connectionId: string | null;
  observedAtMs: number;
  code?: string;
  missingScope?: string;
}

export interface GatewayCapabilitySnapshot {
  connectionId: string | null;
  protocol: number | null;
  serverVersion: string | null;
  methods: readonly string[];
  events: readonly string[];
  negotiatedRole: string | null;
  negotiatedScopes: readonly string[];
  methodsConservative: true;
  methodEvidence: Readonly<Record<string, GatewayCapabilityEvidence>>;
  observedAtMs: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizedCode(value: unknown): string | undefined {
  const code = normalizedString(value);
  return code?.toUpperCase();
}

function errorCode(value: unknown): string | undefined {
  const record = asRecord(value);
  const details = asRecord(record?.details);
  return normalizedCode(details?.code) ?? normalizedCode(record?.code);
}

function connectionUnavailable(value: unknown): boolean {
  const code = errorCode(value);
  return isGatewayTransportLifecycleError(value)
    || code === 'GATEWAY_DISCONNECTED'
    || code === 'GATEWAY_CONNECTION_FENCE_MISMATCH';
}

function requestAwaitingVerification(value: unknown): boolean {
  const code = errorCode(value);
  return value instanceof GatewayRequestTimeoutError || code === 'GATEWAY_REQUEST_ABORTED';
}

export function classifyGatewayCapabilityFailure(value: unknown, method?: string): {
  state: Exclude<GatewayCapabilityState, 'advertised' | 'available'>;
  code?: string;
  missingScope?: string;
} {
  const code = errorCode(value);
  if (method && isOpenClawUnknownMethodError(value, method)) {
    return { state: 'unsupported', ...(code ? { code } : {}) };
  }

  const authorization = classifyGatewayAuthorizationError(value);
  if (authorization) {
    return {
      state: 'unauthorized',
      code: authorization.code,
      ...(authorization.missingScope ? { missingScope: authorization.missingScope } : {}),
    };
  }

  if (connectionUnavailable(value)) {
    return { state: 'unavailable', ...(code ? { code } : {}) };
  }

  if (requestAwaitingVerification(value)) {
    return { state: 'pending_verification', ...(code ? { code } : {}) };
  }

  return { state: 'error', ...(code ? { code } : {}) };
}

function emptySnapshot(): GatewayCapabilitySnapshot {
  return {
    connectionId: null,
    protocol: null,
    serverVersion: null,
    methods: [],
    events: [],
    negotiatedRole: null,
    negotiatedScopes: [],
    methodsConservative: true,
    methodEvidence: {},
    observedAtMs: null,
  };
}

export class GatewayCapabilityRegistry {
  private snapshotValue: GatewayCapabilitySnapshot = emptySnapshot();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  observeHello(observation: GatewayHelloObservation | null): void {
    if (!observation) {
      this.snapshotValue = emptySnapshot();
      return;
    }

    const methodEvidence: Record<string, GatewayCapabilityEvidence> = {};
    for (const method of observation.methods) {
      const normalizedMethod = normalizedString(method);
      if (!normalizedMethod) continue;
      methodEvidence[normalizedMethod] = {
        method: normalizedMethod,
        state: 'advertised',
        source: 'hello',
        connectionId: observation.connectionId || null,
        observedAtMs: observation.observedAtMs,
      };
    }
    this.snapshotValue = {
      connectionId: observation.connectionId || null,
      protocol: observation.protocol,
      serverVersion: observation.serverVersion,
      methods: [...observation.methods],
      events: [...observation.events],
      negotiatedRole: observation.negotiatedRole,
      negotiatedScopes: [...observation.negotiatedScopes],
      methodsConservative: true,
      methodEvidence,
      observedAtMs: observation.observedAtMs,
    };
  }

  recordSuccess(method: string): void {
    this.record(method, {
      state: 'available',
      source: 'rpc',
    });
  }

  recordInvalidResponse(method: string, code?: string): void {
    this.record(method, {
      state: 'invalid_response',
      source: 'rpc',
      ...(normalizedCode(code) ? { code: normalizedCode(code) } : {}),
    });
  }

  recordFailure(method: string, error: unknown): void {
    const classified = classifyGatewayCapabilityFailure(error, method);
    this.record(method, {
      ...classified,
      source: 'rpc',
    });
  }

  get(method: string): GatewayCapabilityEvidence | null {
    const normalizedMethod = normalizedString(method);
    if (!normalizedMethod) return null;
    return this.snapshotValue.methodEvidence[normalizedMethod] ?? null;
  }

  snapshot(): GatewayCapabilitySnapshot {
    const methodEvidence: Record<string, GatewayCapabilityEvidence> = {};
    for (const [method, evidence] of Object.entries(this.snapshotValue.methodEvidence)) {
      methodEvidence[method] = { ...evidence };
    }
    return {
      ...this.snapshotValue,
      methods: [...this.snapshotValue.methods],
      events: [...this.snapshotValue.events],
      negotiatedScopes: [...this.snapshotValue.negotiatedScopes],
      methodEvidence,
    };
  }

  private record(
    method: string,
    update: Omit<GatewayCapabilityEvidence, 'method' | 'connectionId' | 'observedAtMs'>,
  ): void {
    const normalizedMethod = normalizedString(method);
    if (!normalizedMethod) return;
    const methodEvidence = {
      ...this.snapshotValue.methodEvidence,
      [normalizedMethod]: {
        method: normalizedMethod,
        connectionId: this.snapshotValue.connectionId,
        observedAtMs: this.now(),
        ...update,
      },
    };
    this.snapshotValue = { ...this.snapshotValue, methodEvidence };
  }
}
