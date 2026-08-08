import { classifyGatewayAuthorizationError } from './messageRouter';
import { isGatewayTransportLifecycleError } from './GatewayTransportError';
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

const UNSUPPORTED_CODES = new Set([
  'METHOD_NOT_FOUND',
  'UNKNOWN_METHOD',
  'UNKNOWN_COMMAND',
]);

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

function unknownMethodRequest(value: unknown): boolean {
  const record = asRecord(value);
  const code = errorCode(value);
  const message = normalizedString(record?.message) ?? (typeof value === 'string' ? value.trim() : undefined);
  return code === 'INVALID_REQUEST' && Boolean(message && /^(?:unknown method|no handler for)\b/i.test(message));
}

function requestAwaitingVerification(value: unknown): boolean {
  const code = errorCode(value);
  if (code === 'GATEWAY_REQUEST_ABORTED') return true;
  if (typeof value === 'string') return /request\s+timeout/i.test(value);
  const message = normalizedString(asRecord(value)?.message);
  return Boolean(message && /request\s+timeout/i.test(message));
}

export function classifyGatewayCapabilityFailure(value: unknown): {
  state: Exclude<GatewayCapabilityState, 'advertised' | 'available'>;
  code?: string;
  missingScope?: string;
} {
  const code = errorCode(value);
  if (code && UNSUPPORTED_CODES.has(code)) return { state: 'unsupported', code };
  if (unknownMethodRequest(value)) return { state: 'unsupported', ...(code ? { code } : {}) };

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
    const classified = classifyGatewayCapabilityFailure(error);
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
