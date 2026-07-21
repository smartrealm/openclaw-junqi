import { getCollaborationMaintenanceOwner } from '@/api/tauri-commands';
import { gateway } from '@/services/gateway';
import {
  collaborationClient,
  createCollaborationWriteRequest,
  isCollaborationMethodUnavailable as isExactCollaborationMethodUnavailable,
} from './client';
import type {
  CollaborationCapabilities,
  CollaborationWriteMethod,
  CollaborationWriteRequest,
  CollaborationWriteResponse,
} from './types';
import {
  collaborationAbsenceAttestor,
  type CollaborationAbsenceProof,
} from './CollaborationAbsenceAttestation';

const MAINTENANCE_STATUS_METHOD = 'junqi.collab.maintenance.status' as const;
const MAINTENANCE_ENTER_METHOD = 'junqi.collab.maintenance.enter' as const;
const MAINTENANCE_EXIT_METHOD = 'junqi.collab.maintenance.exit' as const;
const DEFAULT_RUNTIME_TIMEOUT_MS = 45_000;
const DEFAULT_RUNTIME_POLL_MS = 500;
// Rust owns a 35-minute absolute update deadline: 30 minutes for the package
// command and five minutes for Gateway recovery. The collaboration lease must
// outlive that deadline long enough for reconnect/status verification and the
// exact lease release RPC; an equal 35-minute window has no handoff margin.
const OPENCLAW_UPDATE_OPERATION_WINDOW_MS = 35 * 60_000;
const MAINTENANCE_RELEASE_RESERVE_MS = 2 * 60_000;
const MINIMUM_MAINTENANCE_OPERATION_WINDOW_MS =
  OPENCLAW_UPDATE_OPERATION_WINDOW_MS + MAINTENANCE_RELEASE_RESERVE_MS;
const MAINTENANCE_OWNER_STORAGE_KEY = 'junqi-collaboration-maintenance-owner-v1';
const MAINTENANCE_OWNER_PATTERN = /^junqi-desktop:[A-Za-z0-9][A-Za-z0-9-]{0,127}$/u;
const MAX_MAINTENANCE_RUN_REFERENCES = 100;

export interface CollaborationMaintenanceRun {
  runId: string;
  status: string;
  goal: string;
  revision: number | null;
}

export interface CollaborationMaintenanceLease {
  maintenanceLeaseId: string;
  collaborationInstanceId: string;
  schemaVersion: number;
  databaseIntegrity: string;
  reason: string;
  owner: string;
  status: 'ACTIVE' | 'EXPIRED';
  enteredAt: number;
  expiresAt: number;
  expiredAt: number | null;
}

export interface CollaborationMaintenanceStatus {
  availability: 'available' | 'not-installed';
  status: 'INACTIVE' | 'ACTIVE' | 'EXPIRED' | 'MALFORMED' | null;
  recoveryRequired: boolean;
  active: boolean;
  collaborationInstanceId: string | null;
  schemaVersion: number | null;
  databaseIntegrity: string | null;
  lease: CollaborationMaintenanceLease | null;
  activeRuns: CollaborationMaintenanceRun[];
  activeRunCount: number;
  activeRunsTruncated: boolean;
  /** Present only when the collaboration RPC is absent and absence was proven. */
  absenceProof?: CollaborationAbsenceProof | null;
}

export interface CollaborationMaintenanceAcquisition {
  guarded: boolean;
  lease: CollaborationMaintenanceLease | null;
  status: CollaborationMaintenanceStatus;
  /** Opaque proof used when the collaboration RPC is absent. */
  absenceProof: CollaborationAbsenceProof | null;
}

export interface CollaborationMaintenanceRelease {
  released: boolean;
  alreadyInactive: boolean;
  lease: CollaborationMaintenanceLease | null;
  status: CollaborationMaintenanceStatus;
}

export interface CollaborationGuardedOperationResult<T> {
  value: T;
  acquisition: CollaborationMaintenanceAcquisition;
  release: CollaborationMaintenanceRelease;
}

export type CollaborationMaintenanceErrorCode =
  | 'STATE_UNKNOWN'
  | 'ACTIVE_RUNS'
  | 'MAINTENANCE_ALREADY_ACTIVE'
  | 'ENTER_FAILED'
  | 'ENTER_OUTCOME_UNKNOWN'
  | 'DATABASE_INTEGRITY_FAILED'
  | 'RUNTIME_NOT_READY'
  | 'INSTANCE_CHANGED'
  | 'SCHEMA_CHANGED'
  | 'LEASE_MISMATCH'
  | 'LEASE_OWNER_MISMATCH'
  | 'LEASE_EXPIRED'
  | 'EXIT_FAILED'
  | 'EXIT_OUTCOME_UNKNOWN'
  | 'OPERATION_FAILED';

export type CollaborationMaintenancePhase =
  | 'status'
  | 'enter'
  | 'operation'
  | 'verify'
  | 'exit'
  | 'recovery';

export class CollaborationMaintenanceError extends Error {
  constructor(
    public readonly code: CollaborationMaintenanceErrorCode,
    message: string,
    public readonly phase: CollaborationMaintenancePhase,
    public readonly lease: CollaborationMaintenanceLease | null = null,
    public readonly activeRuns: CollaborationMaintenanceRun[] = [],
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = 'CollaborationMaintenanceError';
  }

  get recoveryRequired(): boolean {
    return this.lease !== null;
  }
}

export interface CollaborationMaintenanceDependencies {
  capabilities(): Promise<CollaborationCapabilities>;
  attestCollaborationAbsent(): Promise<CollaborationAbsenceProof>;
  assertAbsenceProofCurrent(proof: CollaborationAbsenceProof): Promise<void>;
  readStatus(): Promise<unknown>;
  write<T extends Record<string, unknown>>(
    method: CollaborationWriteMethod,
    request: CollaborationWriteRequest<T>,
  ): Promise<CollaborationWriteResponse>;
  isGatewayConnected(): boolean;
  sleep(milliseconds: number): Promise<void>;
  now(): number;
  randomUUID(): string;
  /** Stable Desktop owner id used to fence recovery across coordinator calls. */
  ownerId?: string;
  /** Resolves the durable installation owner; tests may inject a deterministic value. */
  resolveOwnerId?(): Promise<string>;
}

const defaultDependencies: CollaborationMaintenanceDependencies = {
  capabilities: () => collaborationClient.capabilities(),
  attestCollaborationAbsent: () => collaborationAbsenceAttestor.attest(),
  assertAbsenceProofCurrent: (proof) => collaborationAbsenceAttestor.assertCurrent(proof),
  readStatus: () => gateway.call(MAINTENANCE_STATUS_METHOD, {}),
  write: (method, request) => collaborationClient.write(method, request),
  isGatewayConnected: () => gateway.getStatus().connected,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: () => Date.now(),
  randomUUID: () => globalThis.crypto.randomUUID(),
  resolveOwnerId: async () => {
    if (isTauriRuntime()) {
      const result = await getCollaborationMaintenanceOwner(legacyOwnerId());
      if (!validOwnerId(result.owner)) throw new Error('Tauri returned an invalid maintenance owner');
      try {
        globalThis.localStorage?.setItem(MAINTENANCE_OWNER_STORAGE_KEY, result.owner);
      } catch {
        // The durable Tauri file remains authoritative when WebView storage is unavailable.
      }
      return result.owner;
    }
    return resolveDefaultOwnerId();
  },
};

function validOwnerId(value: unknown): value is string {
  return typeof value === 'string' && MAINTENANCE_OWNER_PATTERN.test(value);
}

function legacyOwnerId(): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(MAINTENANCE_OWNER_STORAGE_KEY)?.trim();
    return validOwnerId(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function resolveDefaultOwnerId(): string {
  const generate = (): string => {
    const randomUuid = globalThis.crypto?.randomUUID;
    const suffix = typeof randomUuid === 'function'
      ? randomUuid.call(globalThis.crypto)
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    return `junqi-desktop:${suffix}`;
  };
  try {
    const stored = globalThis.localStorage?.getItem(MAINTENANCE_OWNER_STORAGE_KEY)?.trim();
    if (validOwnerId(stored)) return stored;
    const generated = generate();
    globalThis.localStorage?.setItem(MAINTENANCE_OWNER_STORAGE_KEY, generated);
    return generated;
  } catch {
    // A non-browser test/runtime has no durable storage. Fail closed on
    // cross-process recovery rather than pretending ownership is known.
    return generate();
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isExplicitlyMissingCollaboration(error: unknown): boolean {
  return isExactCollaborationMethodUnavailable(error);
}

function stringField(value: unknown, field: string, maximumCharacters = 4_096): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumCharacters) {
    throw new Error(`${field} exceeds ${maximumCharacters} characters`);
  }
  return normalized;
}

function optionalTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseRuns(value: unknown): CollaborationMaintenanceRun[] {
  if (!Array.isArray(value)) throw new Error('activeRuns must be an array');
  if (value.length > MAX_MAINTENANCE_RUN_REFERENCES) {
    throw new Error(`activeRuns cannot exceed ${MAX_MAINTENANCE_RUN_REFERENCES} references`);
  }
  return value.map((item, index) => {
    const run = record(item);
    if (!run) throw new Error(`activeRuns[${index}] must be an object`);
    const runId = stringField(run.runId ?? run.id, `activeRuns[${index}].runId`, 512);
    const status = stringField(run.status, `activeRuns[${index}].status`, 64);
    const goal = typeof run.goal === 'string' ? run.goal : '';
    if (goal.length > 4_096) throw new Error(`activeRuns[${index}].goal exceeds 4096 characters`);
    const revision = typeof run.revision === 'number' && Number.isSafeInteger(run.revision)
      ? run.revision
      : null;
    return { runId, status, goal, revision };
  });
}

interface CollaborationMaintenanceRunSnapshot {
  activeRuns: CollaborationMaintenanceRun[];
  activeRunCount: number;
  activeRunsTruncated: boolean;
}

function parseRunSnapshot(
  value: Record<string, unknown>,
  field: string,
): CollaborationMaintenanceRunSnapshot {
  const activeRuns = parseRuns(value.activeRuns);
  const activeRunCount = value.activeRunCount;
  if (
    typeof activeRunCount !== 'number'
    || !Number.isSafeInteger(activeRunCount)
    || activeRunCount < activeRuns.length
  ) {
    throw new Error(`${field}.activeRunCount must cover every returned active Run`);
  }
  if (typeof value.activeRunsTruncated !== 'boolean') {
    throw new Error(`${field}.activeRunsTruncated must be a boolean`);
  }
  const activeRunsTruncated = value.activeRunsTruncated;
  if (activeRunsTruncated !== (activeRunCount > activeRuns.length)) {
    throw new Error(`${field}.activeRunsTruncated must agree with activeRunCount`);
  }
  return { activeRuns, activeRunCount, activeRunsTruncated };
}

interface CapabilityIdentity {
  collaborationInstanceId: string;
  schemaVersion: number;
  databaseIntegrity: string;
}

function parseCapabilityIdentity(capabilities: CollaborationCapabilities): CapabilityIdentity {
  const raw = capabilities as unknown as Record<string, unknown>;
  const collaborationInstanceId = stringField(
    raw.collaborationInstanceId,
    'capabilities.collaborationInstanceId',
  );
  const schemaVersion = raw.schemaVersion;
  if (typeof schemaVersion !== 'number' || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error('capabilities.schemaVersion must be a positive integer');
  }
  const databaseIntegrity = stringField(raw.databaseIntegrity, 'capabilities.databaseIntegrity');
  return { collaborationInstanceId, schemaVersion, databaseIntegrity };
}

function parseLeaseRecord(
  value: unknown,
  identity: CapabilityIdentity,
): CollaborationMaintenanceLease {
  const lease = record(value);
  if (!lease) throw new Error('maintenance lease must be an object');
  const enteredAt = optionalTimestamp(lease.enteredAt);
  if (enteredAt === null) throw new Error('maintenance.lease.enteredAt must be a timestamp');
  const expiresAt = optionalTimestamp(lease.expiresAt);
  if (expiresAt === null) throw new Error('maintenance.lease.expiresAt must be a timestamp');
  if (expiresAt <= enteredAt) {
    throw new Error('maintenance.lease.expiresAt must be later than enteredAt');
  }
  const status = lease.status === undefined ? 'ACTIVE' : lease.status;
  if (status !== 'ACTIVE' && status !== 'EXPIRED') {
    throw new Error('maintenance.lease.status must be ACTIVE or EXPIRED');
  }
  const expiredAt = optionalTimestamp(lease.expiredAt);
  if (status === 'ACTIVE' && expiredAt !== null) {
    throw new Error('active maintenance lease cannot have expiredAt');
  }
  if (status === 'EXPIRED' && expiredAt === null) {
    throw new Error('expired maintenance lease must include expiredAt');
  }
  if (expiredAt !== null && expiredAt < expiresAt) {
    throw new Error('maintenance.lease.expiredAt cannot precede expiresAt');
  }
  return {
    maintenanceLeaseId: stringField(lease.id ?? lease.maintenanceLeaseId, 'maintenance.lease.id', 512),
    collaborationInstanceId: identity.collaborationInstanceId,
    schemaVersion: identity.schemaVersion,
    databaseIntegrity: identity.databaseIntegrity,
    reason: stringField(lease.reason, 'maintenance.lease.reason', 4_096),
    owner: stringField(lease.owner, 'maintenance.lease.owner', 512),
    status,
    enteredAt,
    expiresAt,
    expiredAt,
  };
}

function parseStatus(
  value: unknown,
  identity: CapabilityIdentity,
): CollaborationMaintenanceStatus {
  const response = record(value);
  if (
    !response
    || typeof response.active !== 'boolean'
    || typeof response.gateActive !== 'boolean'
    || typeof response.recoveryRequired !== 'boolean'
  ) {
    throw new Error('maintenance.status returned an invalid response');
  }
  if (response.active !== response.gateActive) {
    throw new Error('maintenance.status active and gateActive must agree');
  }
  const runSnapshot = parseRunSnapshot(response, 'maintenance.status');
  const status = response.status;
  if (status !== 'INACTIVE' && status !== 'ACTIVE' && status !== 'EXPIRED' && status !== 'MALFORMED') {
    throw new Error('maintenance.status.status is invalid');
  }
  if (status === 'MALFORMED') {
    throw new Error('maintenance.status reported malformed durable lease state');
  }
  const lease = response.active ? parseLeaseRecord(response.lease, identity) : null;
  if (!response.active && response.lease != null) {
    throw new Error('maintenance.status returned a lease while inactive');
  }
  const isInactive = status === 'INACTIVE';
  const isExpired = status === 'EXPIRED';
  if (
    response.active === isInactive
    || response.recoveryRequired !== isExpired
    || (lease !== null && lease.status !== status)
  ) {
    throw new Error('maintenance.status fields describe contradictory gate state');
  }
  return {
    availability: 'available',
    status,
    recoveryRequired: response.recoveryRequired,
    active: response.active,
    collaborationInstanceId: identity.collaborationInstanceId,
    schemaVersion: identity.schemaVersion,
    databaseIntegrity: identity.databaseIntegrity,
    lease,
    ...runSnapshot,
    absenceProof: null,
  };
}

function unavailableStatus(absenceProof: CollaborationAbsenceProof): CollaborationMaintenanceStatus {
  return {
    availability: 'not-installed',
    status: null,
    recoveryRequired: false,
    active: false,
    collaborationInstanceId: null,
    schemaVersion: null,
    databaseIntegrity: null,
    lease: null,
    activeRuns: [],
    activeRunCount: 0,
    activeRunsTruncated: false,
    absenceProof,
  };
}

function integrityIsHealthy(value: string): boolean {
  return value.trim().toLowerCase() === 'ok';
}

export class CollaborationMaintenanceCoordinator {
  private pendingLease: CollaborationMaintenanceLease | null = null;
  private ownerId: string | null;

  constructor(
    private readonly dependencies: CollaborationMaintenanceDependencies = defaultDependencies,
  ) {
    const configuredOwner = dependencies.ownerId;
    if (configuredOwner !== undefined && !validOwnerId(configuredOwner)) {
      throw new TypeError('ownerId must be a stable junqi-desktop owner id');
    }
    this.ownerId = configuredOwner ?? null;
  }

  getPendingLease(): CollaborationMaintenanceLease | null {
    return this.pendingLease;
  }

  private async resolveOwnerId(phase: CollaborationMaintenancePhase): Promise<string> {
    if (this.ownerId) return this.ownerId;
    try {
      const resolved = await this.dependencies.resolveOwnerId?.() ?? resolveDefaultOwnerId();
      if (!validOwnerId(resolved)) throw new Error('Maintenance owner is malformed');
      this.ownerId = resolved;
      return resolved;
    } catch (error) {
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'A durable Desktop maintenance owner could not be resolved',
        phase,
        this.pendingLease,
        [],
        error,
      );
    }
  }

  async inspect(): Promise<CollaborationMaintenanceStatus> {
    let capabilities: CollaborationCapabilities;
    try {
      capabilities = await this.dependencies.capabilities();
    } catch (error) {
      if (isExplicitlyMissingCollaboration(error)) {
        try {
          const absenceProof = await this.dependencies.attestCollaborationAbsent();
          return unavailableStatus(absenceProof);
        } catch (attestationError) {
          throw new CollaborationMaintenanceError(
            'STATE_UNKNOWN',
            'Collaboration RPC is unavailable and durable collaboration absence could not be proven',
            'status',
            this.pendingLease,
            [],
            { capabilityError: error, attestationError },
          );
        }
      }
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration maintenance state could not be read',
        'status',
        this.pendingLease,
        [],
        error,
      );
    }

    let identity: CapabilityIdentity;
    try {
      identity = parseCapabilityIdentity(capabilities);
    } catch (error) {
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration capabilities did not contain a verifiable runtime identity',
        'status',
        this.pendingLease,
        [],
        error,
      );
    }
    if (!integrityIsHealthy(identity.databaseIntegrity)) {
      throw new CollaborationMaintenanceError(
        'DATABASE_INTEGRITY_FAILED',
        `Collaboration database integrity check returned ${identity.databaseIntegrity}`,
        'status',
        this.pendingLease,
      );
    }

    try {
      return parseStatus(await this.dependencies.readStatus(), identity);
    } catch (error) {
      if (error instanceof CollaborationMaintenanceError) throw error;
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration maintenance status is unknown',
        'status',
        this.pendingLease,
        [],
        error,
      );
    }
  }

  async acquire(reason: string): Promise<CollaborationMaintenanceAcquisition> {
    const normalizedReason = stringField(reason, 'reason');
    const preflight = await this.inspect();
    if (preflight.availability === 'not-installed') {
      return {
        guarded: false,
        lease: null,
        status: preflight,
        absenceProof: preflight.absenceProof ?? null,
      };
    }
    if (preflight.active) {
      this.pendingLease = preflight.lease;
      throw new CollaborationMaintenanceError(
        'MAINTENANCE_ALREADY_ACTIVE',
        'A collaboration maintenance lease is already active and requires explicit recovery',
        'enter',
        preflight.lease,
        preflight.activeRuns,
      );
    }
    if (preflight.activeRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance is blocked by ${preflight.activeRunCount} active collaboration run(s)`,
        'enter',
        null,
        preflight.activeRuns,
      );
    }

    const operationId = this.dependencies.randomUUID();
    const owner = await this.resolveOwnerId('enter');
    const request = await createCollaborationWriteRequest(
      { reason: normalizedReason, owner },
      { expectedCollaborationInstanceId: stringField(
        preflight.collaborationInstanceId,
        'collaborationInstanceId',
      ) },
      operationId,
    );
    let response: CollaborationWriteResponse;
    try {
      response = await this.dependencies.write(MAINTENANCE_ENTER_METHOD, request);
    } catch (error) {
      return this.reconcileEnterFailure(normalizedReason, owner, preflight, error);
    }

    const responseRecord = response as Record<string, unknown>;
    let leaseId: string;
    let enteredRuns: CollaborationMaintenanceRunSnapshot;
    let databaseIntegrity: string;
    try {
      if (response.accepted !== true) throw new Error('maintenance.enter was not accepted');
      leaseId = stringField(responseRecord.maintenanceLeaseId, 'maintenanceLeaseId');
      databaseIntegrity = stringField(responseRecord.databaseIntegrity, 'databaseIntegrity');
      enteredRuns = parseRunSnapshot(responseRecord, 'maintenance.enter');
    } catch (error) {
      return this.reconcileEnterFailure(normalizedReason, owner, preflight, error);
    }

    const confirmed = await this.confirmEnteredLease(leaseId, owner, normalizedReason, preflight);
    const lease = {
      ...confirmed.lease!,
      databaseIntegrity,
    };
    this.pendingLease = lease;
    const combinedRuns = enteredRuns.activeRuns.length > 0
      ? enteredRuns.activeRuns
      : confirmed.activeRuns;
    const combinedRunCount = Math.max(enteredRuns.activeRunCount, confirmed.activeRunCount);
    if (!integrityIsHealthy(databaseIntegrity)) {
      throw new CollaborationMaintenanceError(
        'DATABASE_INTEGRITY_FAILED',
        `Maintenance checkpoint integrity check returned ${databaseIntegrity}`,
        'enter',
        lease,
        combinedRuns,
      );
    }
    if (combinedRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance gate is held, but ${combinedRunCount} collaboration run(s) remain unsettled`,
        'enter',
        lease,
        combinedRuns,
      );
    }
    return { guarded: true, lease, status: { ...confirmed, lease }, absenceProof: null };
  }

  operationFailed(
    acquisition: CollaborationMaintenanceAcquisition,
    error: unknown,
  ): CollaborationMaintenanceError {
    const message = error instanceof Error ? error.message : String(error || 'Maintenance operation failed');
    if (acquisition.lease) this.pendingLease = acquisition.lease;
    return new CollaborationMaintenanceError(
      'OPERATION_FAILED',
      message,
      'operation',
      acquisition.lease,
      acquisition.status.activeRuns,
      error,
    );
  }

  async runGuarded<T>(
    reason: string,
    operation: () => Promise<T>,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<CollaborationGuardedOperationResult<T>> {
    const acquisition = await this.acquire(reason);
    await this.assertAcquisitionCurrent(acquisition);
    let value: T;
    try {
      value = await operation();
    } catch (error) {
      if (acquisition.guarded) throw this.operationFailed(acquisition, error);
      throw error;
    }
    const release = acquisition.guarded && acquisition.lease
      ? await this.verifyAndRelease(acquisition.lease, options)
      : {
          released: false,
          alreadyInactive: true,
          lease: null,
          status: acquisition.status,
        };
    return { value, acquisition, release };
  }

  /** Revalidate a plugin-absent acquisition immediately before mutation. */
  async assertAcquisitionCurrent(acquisition: CollaborationMaintenanceAcquisition): Promise<void> {
    if (acquisition.guarded) {
      if (!acquisition.lease) {
        throw new CollaborationMaintenanceError(
          'LEASE_MISMATCH',
          'A guarded maintenance acquisition is missing its lease identity',
          'operation',
        );
      }
      await this.assertLeaseCurrent(acquisition.lease);
      return;
    }
    if (!acquisition.absenceProof) {
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration absence proof is missing; the operation was not attempted',
        'operation',
      );
    }
    try {
      await this.dependencies.assertAbsenceProofCurrent(acquisition.absenceProof);
    } catch (error) {
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration absence proof is no longer current; the operation was not attempted',
        'operation',
        null,
        [],
        error,
      );
    }
  }

  async verifyAndRelease(
    lease: CollaborationMaintenanceLease | null = this.pendingLease,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<CollaborationMaintenanceRelease> {
    if (!lease) {
      return this.recover(options);
    }
    return this.verifyAndReleaseWithPolicy(lease, options, false);
  }

  private async verifyAndReleaseWithPolicy(
    lease: CollaborationMaintenanceLease,
    options: { timeoutMs?: number; pollMs?: number },
    allowExpiredRecovery: boolean,
  ): Promise<CollaborationMaintenanceRelease> {
    const owner = await this.resolveOwnerId('exit');
    this.assertOwnedLease(lease, 'exit', owner);
    this.pendingLease = lease;
    const identity = await this.waitForRuntimeIdentity(
      options.timeoutMs ?? DEFAULT_RUNTIME_TIMEOUT_MS,
      options.pollMs ?? DEFAULT_RUNTIME_POLL_MS,
      lease,
    );
    this.assertSameRuntime(lease, identity);

    const status = await this.readStatusForIdentity(identity, lease, 'verify');
    // Treat the local lease clock as a second fail-closed fence. The plugin
    // normally projects EXPIRED itself, but a delayed/stale status response
    // must not make an already elapsed lease releasable through the normal
    // completion path.
    const expired = status.recoveryRequired
      || status.status === 'EXPIRED'
      || status.lease?.status === 'EXPIRED'
      || (status.lease?.expiresAt !== undefined && status.lease.expiresAt <= this.dependencies.now());
    if (expired && !allowExpiredRecovery) {
      this.pendingLease = status.lease ?? lease;
      throw new CollaborationMaintenanceError(
        'LEASE_EXPIRED',
        'The maintenance lease expired before the operation could be released; explicit recovery is required',
        'verify',
        status.lease ?? lease,
        status.activeRuns,
      );
    }
    if (!status.active || !status.lease) {
      this.pendingLease = null;
      return { released: false, alreadyInactive: true, lease: null, status };
    }
    this.assertOwnedLease(status.lease, 'verify', owner);
    if (
      status.lease.maintenanceLeaseId !== lease.maintenanceLeaseId
      || status.lease.reason !== lease.reason
    ) {
      throw new CollaborationMaintenanceError(
        'LEASE_MISMATCH',
        'The active maintenance lease changed before health verification completed',
        'verify',
        status.lease,
        status.activeRuns,
      );
    }
    if (status.activeRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance cannot exit while ${status.activeRunCount} collaboration run(s) remain unsettled`,
        'verify',
        lease,
        status.activeRuns,
      );
    }

    const commandId = this.dependencies.randomUUID();
    const request = await createCollaborationWriteRequest(
      {
        maintenanceLeaseId: lease.maintenanceLeaseId,
        owner,
        healthVerified: true,
      },
      { expectedCollaborationInstanceId: lease.collaborationInstanceId },
      commandId,
    );
    try {
      const response = await this.dependencies.write(MAINTENANCE_EXIT_METHOD, request);
      if (response.accepted !== true || (response as Record<string, unknown>).active !== false) {
        throw new Error('maintenance.exit returned an unverifiable response');
      }
    } catch (error) {
      return this.reconcileExitFailure(lease, identity, error);
    }

    const after = await this.readStatusForIdentity(identity, lease, 'exit');
    if (after.active) {
      throw new CollaborationMaintenanceError(
        'EXIT_OUTCOME_UNKNOWN',
        'Maintenance exit was accepted but the authoritative gate remains active',
        'exit',
        after.lease ?? lease,
        after.activeRuns,
      );
    }
    this.pendingLease = null;
    return { released: true, alreadyInactive: false, lease, status: after };
  }

  async recover(
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<CollaborationMaintenanceRelease> {
    const status = await this.inspect();
    if (status.availability === 'not-installed' || !status.active || !status.lease) {
      this.pendingLease = null;
      return { released: false, alreadyInactive: true, lease: null, status };
    }
    const owner = await this.resolveOwnerId('recovery');
    this.assertOwnedLease(status.lease, 'recovery', owner);
    this.pendingLease = status.lease;
    if (status.activeRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance recovery is blocked by ${status.activeRunCount} active collaboration run(s)`,
        'recovery',
        status.lease,
        status.activeRuns,
      );
    }
    return this.verifyAndReleaseWithPolicy(status.lease, options, true);
  }

  private async confirmEnteredLease(
    leaseId: string,
    owner: string,
    reason: string,
    preflight: CollaborationMaintenanceStatus,
  ): Promise<CollaborationMaintenanceStatus> {
    let status: CollaborationMaintenanceStatus;
    try {
      status = await this.inspect();
    } catch (error) {
      throw new CollaborationMaintenanceError(
        'ENTER_OUTCOME_UNKNOWN',
        'Maintenance gate may be active, but its lease could not be confirmed',
        'enter',
        this.pendingLease,
        [],
        error,
      );
    }
    this.assertAcquisitionRuntime(preflight, status);
    const lease = status.lease;
    if (!status.active || !lease) {
      throw new CollaborationMaintenanceError(
        'ENTER_OUTCOME_UNKNOWN',
        'Maintenance enter was accepted but the authoritative gate is inactive',
        'enter',
      );
    }
    if (lease.maintenanceLeaseId !== leaseId || lease.owner !== owner || lease.reason !== reason) {
      this.pendingLease = lease;
      throw new CollaborationMaintenanceError(
        'LEASE_MISMATCH',
        'Maintenance lease identity changed while entering the gate',
        'enter',
        lease,
        status.activeRuns,
      );
    }
    return status;
  }

  private assertOwnedLease(
    lease: CollaborationMaintenanceLease,
    phase: CollaborationMaintenancePhase,
    owner: string,
  ): void {
    if (lease.owner === owner) return;
    throw new CollaborationMaintenanceError(
      'LEASE_OWNER_MISMATCH',
      'The maintenance lease belongs to another Desktop owner and cannot be released here',
      phase,
      lease,
    );
  }

  /** Re-read the authoritative gate at the exact mutation use point. */
  private async assertLeaseCurrent(lease: CollaborationMaintenanceLease): Promise<void> {
    const owner = await this.resolveOwnerId('operation');
    this.assertOwnedLease(lease, 'operation', owner);
    let status: CollaborationMaintenanceStatus;
    try {
      status = await this.inspect();
    } catch (error) {
      if (error instanceof CollaborationMaintenanceError) throw error;
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Maintenance lease could not be revalidated before mutation',
        'operation',
        lease,
        [],
        error,
      );
    }
    if (
      status.availability !== 'available'
      || !status.active
      || !status.lease
      || status.lease.maintenanceLeaseId !== lease.maintenanceLeaseId
      || status.lease.owner !== lease.owner
      || status.lease.reason !== lease.reason
      || status.collaborationInstanceId !== lease.collaborationInstanceId
      || status.schemaVersion !== lease.schemaVersion
      || !integrityIsHealthy(status.databaseIntegrity ?? '')
    ) {
      throw new CollaborationMaintenanceError(
        'LEASE_MISMATCH',
        'The maintenance lease changed before the operation started',
        'operation',
        status.lease ?? lease,
        status.activeRuns,
      );
    }
    this.assertOwnedLease(status.lease, 'operation', owner);
    if (
      status.lease.expiresAt == null
      || status.lease.expiresAt - this.dependencies.now() < MINIMUM_MAINTENANCE_OPERATION_WINDOW_MS
    ) {
      throw new CollaborationMaintenanceError(
        'LEASE_EXPIRED',
        'The maintenance lease does not cover the bounded operation window',
        'operation',
        status.lease,
        status.activeRuns,
      );
    }
    if (status.activeRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance cannot start while ${status.activeRunCount} collaboration run(s) remain unsettled`,
        'operation',
        status.lease,
        status.activeRuns,
      );
    }
  }

  private async reconcileEnterFailure(
    reason: string,
    owner: string,
    preflight: CollaborationMaintenanceStatus,
    originalError: unknown,
  ): Promise<CollaborationMaintenanceAcquisition> {
    let status: CollaborationMaintenanceStatus;
    try {
      status = await this.inspect();
    } catch (statusError) {
      throw new CollaborationMaintenanceError(
        'ENTER_OUTCOME_UNKNOWN',
        'Maintenance enter failed and its authoritative outcome is unknown',
        'enter',
        this.pendingLease,
        [],
        { originalError, statusError },
      );
    }
    this.assertAcquisitionRuntime(preflight, status);
    if (!status.active || !status.lease) {
      throw new CollaborationMaintenanceError(
        'ENTER_FAILED',
        'Maintenance gate was not entered',
        'enter',
        null,
        status.activeRuns,
        originalError,
      );
    }
    if (status.lease.owner !== owner || status.lease.reason !== reason) {
      this.pendingLease = status.lease;
      throw new CollaborationMaintenanceError(
        'MAINTENANCE_ALREADY_ACTIVE',
        'Another maintenance lease became active while entering the gate',
        'enter',
        status.lease,
        status.activeRuns,
        originalError,
      );
    }
    this.pendingLease = status.lease;
    if (status.activeRunCount > 0) {
      throw new CollaborationMaintenanceError(
        'ACTIVE_RUNS',
        `Maintenance gate is held, but ${status.activeRunCount} collaboration run(s) remain unsettled`,
        'enter',
        status.lease,
        status.activeRuns,
        originalError,
      );
    }
    return { guarded: true, lease: status.lease, status, absenceProof: null };
  }

  private async waitForRuntimeIdentity(
    timeoutMs: number,
    pollMs: number,
    lease: CollaborationMaintenanceLease,
  ): Promise<CapabilityIdentity> {
    const startedAt = this.dependencies.now();
    let lastError: unknown = new Error('Gateway is not connected');
    while (this.dependencies.now() - startedAt <= timeoutMs) {
      if (this.dependencies.isGatewayConnected()) {
        try {
          const identity = parseCapabilityIdentity(await this.dependencies.capabilities());
          if (!integrityIsHealthy(identity.databaseIntegrity)) {
            throw new CollaborationMaintenanceError(
              'DATABASE_INTEGRITY_FAILED',
              `Collaboration database integrity check returned ${identity.databaseIntegrity}`,
              'verify',
              lease,
            );
          }
          return identity;
        } catch (error) {
          if (error instanceof CollaborationMaintenanceError) throw error;
          lastError = error;
        }
      }
      await this.dependencies.sleep(Math.max(1, pollMs));
    }
    throw new CollaborationMaintenanceError(
      'RUNTIME_NOT_READY',
      'Gateway did not reconnect with verifiable collaboration capabilities before the timeout',
      'verify',
      lease,
      [],
      lastError,
    );
  }

  private assertSameRuntime(lease: CollaborationMaintenanceLease, identity: CapabilityIdentity): void {
    if (identity.collaborationInstanceId !== lease.collaborationInstanceId) {
      throw new CollaborationMaintenanceError(
        'INSTANCE_CHANGED',
        'Collaboration instance changed during maintenance',
        'verify',
        lease,
      );
    }
    if (identity.schemaVersion !== lease.schemaVersion) {
      throw new CollaborationMaintenanceError(
        'SCHEMA_CHANGED',
        'Collaboration schema changed without an explicit migration verification',
        'verify',
        lease,
      );
    }
  }

  private assertAcquisitionRuntime(
    preflight: CollaborationMaintenanceStatus,
    confirmed: CollaborationMaintenanceStatus,
  ): void {
    if (confirmed.collaborationInstanceId !== preflight.collaborationInstanceId) {
      this.pendingLease = confirmed.lease;
      throw new CollaborationMaintenanceError(
        'INSTANCE_CHANGED',
        'Collaboration instance changed while entering maintenance',
        'enter',
        confirmed.lease,
        confirmed.activeRuns,
      );
    }
    if (confirmed.schemaVersion !== preflight.schemaVersion) {
      this.pendingLease = confirmed.lease;
      throw new CollaborationMaintenanceError(
        'SCHEMA_CHANGED',
        'Collaboration schema changed while entering maintenance',
        'enter',
        confirmed.lease,
        confirmed.activeRuns,
      );
    }
  }

  private async readStatusForIdentity(
    identity: CapabilityIdentity,
    lease: CollaborationMaintenanceLease,
    phase: CollaborationMaintenancePhase,
  ): Promise<CollaborationMaintenanceStatus> {
    try {
      return parseStatus(await this.dependencies.readStatus(), identity);
    } catch (error) {
      throw new CollaborationMaintenanceError(
        'STATE_UNKNOWN',
        'Collaboration maintenance status could not be verified',
        phase,
        lease,
        [],
        error,
      );
    }
  }

  private async reconcileExitFailure(
    lease: CollaborationMaintenanceLease,
    identity: CapabilityIdentity,
    originalError: unknown,
  ): Promise<CollaborationMaintenanceRelease> {
    let status: CollaborationMaintenanceStatus;
    try {
      status = await this.readStatusForIdentity(identity, lease, 'exit');
    } catch (statusError) {
      throw new CollaborationMaintenanceError(
        'EXIT_OUTCOME_UNKNOWN',
        'Maintenance exit failed and its authoritative outcome is unknown',
        'exit',
        lease,
        [],
        { originalError, statusError },
      );
    }
    if (!status.active) {
      this.pendingLease = null;
      return { released: true, alreadyInactive: false, lease, status };
    }
    this.pendingLease = status.lease ?? lease;
    throw new CollaborationMaintenanceError(
      'EXIT_FAILED',
      'Maintenance exit failed; the lease remains active for explicit recovery',
      'exit',
      status.lease ?? lease,
      status.activeRuns,
      originalError,
    );
  }
}

export const collaborationMaintenanceCoordinator = new CollaborationMaintenanceCoordinator();
