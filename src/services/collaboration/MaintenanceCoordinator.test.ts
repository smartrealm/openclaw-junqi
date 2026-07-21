import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CollaborationMaintenanceCoordinator,
  CollaborationMaintenanceError,
  type CollaborationMaintenanceDependencies,
} from './MaintenanceCoordinator';
import type {
  CollaborationCapabilities,
  CollaborationWriteResponse,
} from './types';
import type { CollaborationAbsenceProof } from './CollaborationAbsenceAttestation';

function capabilities(
  overrides: Record<string, unknown> = {},
): CollaborationCapabilities {
  return {
    collaborationInstanceId: 'instance-a',
    schemaVersion: 1,
    databaseIntegrity: 'ok',
    durableRuntime: true,
    configuredAgents: [],
    coordinatorAgentId: null,
    allowedAgentIds: [],
    repairs: [],
    sessionCapabilities: {
      deleteExpectedSessionId: true,
      resetExpectedSessionId: false,
    },
    ...overrides,
  } as CollaborationCapabilities;
}

function lease(
  owner = 'junqi-desktop:operation-1',
  reason = 'openclaw-update',
  expiresAt = 45 * 60_000 + 100,
  status: 'ACTIVE' | 'EXPIRED' = 'ACTIVE',
) {
  return {
    id: 'maintenance-1',
    reason,
    owner,
    status,
    enteredAt: 100,
    expiresAt,
    ...(status === 'EXPIRED' ? { expiredAt: expiresAt + 1 } : {}),
  };
}

function inactiveStatus(activeRuns: unknown[] = [], activeRunCount = activeRuns.length) {
  return {
    active: false,
    gateActive: false,
    status: 'INACTIVE',
    recoveryRequired: false,
    lease: null,
    activeRuns,
    activeRunCount,
    activeRunsTruncated: activeRunCount > activeRuns.length,
  };
}

function activeStatus(
  activeRuns: unknown[] = [],
  owner?: string,
  reason?: string,
  expiresAt?: number,
  leaseStatus: 'ACTIVE' | 'EXPIRED' = 'ACTIVE',
) {
  return {
    active: true,
    gateActive: true,
    status: leaseStatus,
    recoveryRequired: leaseStatus === 'EXPIRED',
    lease: lease(owner, reason, expiresAt, leaseStatus),
    activeRuns,
    activeRunCount: activeRuns.length,
    activeRunsTruncated: false,
  };
}

const absenceProof = {
  targetFingerprint: 'target-1',
  connectionId: 'connection-1',
  targetClass: 'system_service',
  deploymentKind: 'system_service',
  ownership: 'junqi_managed',
  gatewayVersion: '2026.7.1',
  localStateDir: '/tmp/openclaw',
  localConfigPath: '/tmp/openclaw/openclaw.json',
  issuedAtMs: 1,
  expiresAtMs: Number.MAX_SAFE_INTEGER,
  assertCurrent() {},
} as CollaborationAbsenceProof;

function run(id = 'run-1') {
  return { id, status: 'RUNNING', goal: `Goal ${id}`, revision: 3 };
}

interface HarnessOptions {
  capabilityValues?: Array<CollaborationCapabilities | Error | Record<string, unknown>>;
  statusValues?: Array<unknown>;
  enterResponse?: Record<string, unknown>;
  enterError?: unknown;
  exitError?: unknown;
  connected?: boolean;
  absenceAttested?: boolean;
  absenceProofCurrent?: boolean;
  useResolvedOwner?: boolean;
  resolveOwnerId?: () => Promise<string>;
  now?: number;
}

function harness(options: HarnessOptions = {}) {
  const capabilityValues = [...(options.capabilityValues ?? [capabilities()])];
  const statusValues = [...(options.statusValues ?? [inactiveStatus()])];
  const writes: Array<{ method: string; request: Record<string, unknown> }> = [];
  let clock = options.now ?? 1_000;
  let uuid = 0;
  const nextCapability = () => {
    const value = capabilityValues.length > 1 ? capabilityValues.shift() : capabilityValues[0];
    if (value instanceof Error) throw value;
    return value as CollaborationCapabilities;
  };
  const nextStatus = () => {
    if (statusValues.length === 0) throw new Error('No maintenance status response queued');
    const value = statusValues.length > 1 ? statusValues.shift() : statusValues[0];
    if (value instanceof Error) throw value;
    return value;
  };
  const dependencies: CollaborationMaintenanceDependencies = {
    capabilities: async () => nextCapability(),
    attestCollaborationAbsent: async () => {
      if (options.absenceAttested !== true) {
        throw new Error('durable collaboration absence is not attested');
      }
      return absenceProof;
    },
    assertAbsenceProofCurrent: async (proof) => {
      if (options.absenceProofCurrent === false) throw new Error('Gateway identity changed');
      proof.assertCurrent();
    },
    readStatus: async () => nextStatus(),
    write: async (method, request): Promise<CollaborationWriteResponse> => {
      writes.push({ method, request: request as Record<string, unknown> });
      if (method === 'junqi.collab.maintenance.enter') {
        if (options.enterError) throw options.enterError;
        return {
          collaborationInstanceId: request.expectedCollaborationInstanceId,
          accepted: true,
          replayed: false,
          commandId: request.commandId,
          maintenanceLeaseId: 'maintenance-1',
          databaseIntegrity: 'ok',
          activeRuns: [],
          activeRunCount: 0,
          activeRunsTruncated: false,
          ...options.enterResponse,
        };
      }
      if (method === 'junqi.collab.maintenance.exit') {
        if (options.exitError) throw options.exitError;
        return {
          collaborationInstanceId: request.expectedCollaborationInstanceId,
          accepted: true,
          replayed: false,
          commandId: request.commandId,
          maintenanceLeaseId: request.maintenanceLeaseId,
          active: false,
        };
      }
      throw new Error(`Unexpected write ${method}`);
    },
    isGatewayConnected: () => options.connected !== false,
    sleep: async (milliseconds) => { clock += milliseconds; },
    now: () => clock,
    randomUUID: () => `operation-${++uuid}`,
    // Tests model one stable Desktop process.  A fresh owner per coordinator
    // would make an authoritative lease look foreign during confirmation and
    // recovery, which is precisely the boundary this suite exercises.
    ownerId: options.useResolvedOwner ? undefined : 'junqi-desktop:operation-1',
    resolveOwnerId: options.resolveOwnerId,
  };
  return {
    coordinator: new CollaborationMaintenanceCoordinator(dependencies),
    writes,
  };
}

async function expectMaintenanceError(
  promise: Promise<unknown>,
  code: CollaborationMaintenanceError['code'],
): Promise<CollaborationMaintenanceError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof CollaborationMaintenanceError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`Expected ${code}`);
}

test('an explicitly missing collaboration plugin is the only unguarded update path', async () => {
  const missing = Object.assign(new Error('unknown method junqi.collab.capabilities'), {
    code: 'METHOD_NOT_FOUND',
  });
  const { coordinator, writes } = harness({
    capabilityValues: [missing],
    absenceAttested: true,
  });

  const acquisition = await coordinator.acquire('openclaw-update');

  assert.equal(acquisition.guarded, false);
  assert.equal(acquisition.status.availability, 'not-installed');
  assert.equal(acquisition.absenceProof?.connectionId, 'connection-1');
  assert.equal(writes.length, 0);
});

test('identity drift after an absence probe blocks an unguarded operation', async () => {
  const missing = Object.assign(new Error('unknown method junqi.collab.capabilities'), {
    code: 'METHOD_NOT_FOUND',
  });
  const { coordinator } = harness({
    capabilityValues: [missing],
    absenceAttested: true,
    absenceProofCurrent: false,
  });
  let operationCalls = 0;

  const error = await expectMaintenanceError(
    coordinator.runGuarded('openclaw-update', async () => {
      operationCalls += 1;
      return true;
    }),
    'STATE_UNKNOWN',
  );

  assert.match(error.message, /proof is no longer current/i);
  assert.equal(operationCalls, 0);
});

test('a missing collaboration RPC remains guarded when durable absence is not attested', async () => {
  const missing = Object.assign(new Error('unknown method junqi.collab.capabilities'), {
    code: 'METHOD_NOT_FOUND',
  });
  const { coordinator, writes } = harness({ capabilityValues: [missing] });

  const error = await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'STATE_UNKNOWN');

  assert.match(error.message, /absence could not be proven/i);
  assert.equal(writes.length, 0);
});

test('active runs block maintenance before any write and are surfaced to the caller', async () => {
  const { coordinator, writes } = harness({ statusValues: [inactiveStatus([run()], 501)] });

  const error = await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'ACTIVE_RUNS');

  assert.equal(error.lease, null);
  assert.match(error.message, /501 active collaboration run/i);
  assert.deepEqual(error.activeRuns.map((item) => item.runId), ['run-1']);
  assert.equal(writes.length, 0);
});

test('successful update maintenance uses one lease through enter, verification, and exit', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities(), capabilities()],
    statusValues: [inactiveStatus(), activeStatus(), activeStatus(), inactiveStatus()],
  });

  const acquisition = await coordinator.acquire('openclaw-update');
  assert.equal(acquisition.guarded, true);
  assert.equal(acquisition.lease?.maintenanceLeaseId, 'maintenance-1');

  const release = await coordinator.verifyAndRelease(acquisition.lease);

  assert.equal(release.released, true);
  assert.equal(coordinator.getPendingLease(), null);
  assert.deepEqual(writes.map((item) => item.method), [
    'junqi.collab.maintenance.enter',
    'junqi.collab.maintenance.exit',
  ]);
  assert.equal(writes[0].request.reason, 'openclaw-update');
  assert.equal(writes[0].request.owner, 'junqi-desktop:operation-1');
  assert.equal(writes[0].request.expectedCollaborationInstanceId, 'instance-a');
  assert.equal(writes[1].request.maintenanceLeaseId, 'maintenance-1');
  assert.equal(writes[1].request.owner, 'junqi-desktop:operation-1');
  assert.equal(writes[1].request.healthVerified, true);
  assert.equal(writes[1].request.expectedCollaborationInstanceId, 'instance-a');
  assert.equal(typeof writes[0].request.payloadHash, 'string');
  assert.equal(typeof writes[1].request.payloadHash, 'string');
  assert.equal(writes.some((item) => /cancel/i.test(item.method)), false);
});

test('a lost enter response is reconciled by the unique lease owner without a second enter', async () => {
  const { coordinator, writes } = harness({
    statusValues: [inactiveStatus(), activeStatus()],
    enterError: new Error('socket closed after send'),
  });

  const acquisition = await coordinator.acquire('openclaw-update');

  assert.equal(acquisition.guarded, true);
  assert.equal(acquisition.lease?.owner, 'junqi-desktop:operation-1');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('maintenance uses the durable owner resolver instead of WebView-local identity', async () => {
  const durableOwner = 'junqi-desktop:durable-owner-1';
  const { coordinator, writes } = harness({
    useResolvedOwner: true,
    resolveOwnerId: async () => durableOwner,
    statusValues: [inactiveStatus(), activeStatus([], durableOwner)],
  });

  const acquisition = await coordinator.acquire('openclaw-update');

  assert.equal(acquisition.lease?.owner, durableOwner);
  assert.equal(writes[0]?.request.owner, durableOwner);
});

test('an instance switch during enter is rejected even when lease fields happen to match', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities({ collaborationInstanceId: 'instance-b' })],
    statusValues: [inactiveStatus(), activeStatus()],
  });

  const error = await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'INSTANCE_CHANGED');

  assert.equal(error.lease?.collaborationInstanceId, 'instance-b');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('runs that race with enter leave the acquired gate closed for explicit recovery', async () => {
  const { coordinator, writes } = harness({
    statusValues: [inactiveStatus(), activeStatus([run('run-race')])],
    enterResponse: {
      activeRuns: [run('run-race')],
      activeRunCount: 1,
      activeRunsTruncated: false,
    },
  });

  const error = await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'ACTIVE_RUNS');

  assert.equal(error.lease?.maintenanceLeaseId, 'maintenance-1');
  assert.equal(error.recoveryRequired, true);
  assert.deepEqual(error.activeRuns.map((item) => item.runId), ['run-race']);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('a guarded operation failure preserves its lease and never attempts exit', async () => {
  const { coordinator, writes } = harness({
    // acquire() confirms the entered lease, then runGuarded() performs a
    // use-point recheck immediately before invoking the mutation.
    statusValues: [
      inactiveStatus(),
      activeStatus([], undefined, 'storage-migration'),
      activeStatus([], undefined, 'storage-migration'),
    ],
  });

  const error = await expectMaintenanceError(
    coordinator.runGuarded('storage-migration', async () => {
      throw new Error('copy verification failed');
    }),
    'OPERATION_FAILED',
  );

  assert.equal(error.recoveryRequired, true);
  assert.equal(error.lease?.maintenanceLeaseId, 'maintenance-1');
  assert.equal(coordinator.getPendingLease()?.maintenanceLeaseId, 'maintenance-1');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('a guarded operation is not invoked when the lease disappears at the use point', async () => {
  const { coordinator, writes } = harness({
    statusValues: [inactiveStatus(), activeStatus(), inactiveStatus()],
  });
  let operationCalls = 0;

  const error = await expectMaintenanceError(
    coordinator.runGuarded('openclaw-update', async () => {
      operationCalls += 1;
      return true;
    }),
    'LEASE_MISMATCH',
  );

  assert.equal(operationCalls, 0);
  assert.equal(error.recoveryRequired, true);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('a lease without the update, Gateway-recovery, and release budget cannot start', async () => {
  const { coordinator, writes } = harness({
    statusValues: [
      inactiveStatus(),
      activeStatus(),
      activeStatus([], undefined, undefined, 37 * 60_000 - 100),
    ],
  });
  let operationCalls = 0;

  const error = await expectMaintenanceError(
    coordinator.runGuarded('openclaw-update', async () => {
      operationCalls += 1;
      return true;
    }),
    'LEASE_EXPIRED',
  );

  assert.match(error.message, /bounded operation window/i);
  assert.equal(operationCalls, 0);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('runtime instance changes block exit and preserve the original lease', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [
      capabilities(),
      capabilities(),
      capabilities({ collaborationInstanceId: 'instance-b' }),
    ],
    statusValues: [inactiveStatus(), activeStatus()],
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease),
    'INSTANCE_CHANGED',
  );

  assert.equal(error.lease?.collaborationInstanceId, 'instance-a');
  assert.equal(coordinator.getPendingLease()?.maintenanceLeaseId, 'maintenance-1');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('an authoritative lease owner change blocks exit before the release request', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities(), capabilities()],
    statusValues: [
      inactiveStatus(),
      activeStatus(),
      activeStatus([], 'junqi-desktop:other-owner'),
    ],
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease),
    'LEASE_OWNER_MISMATCH',
  );

  assert.equal(error.recoveryRequired, true);
  assert.equal(coordinator.getPendingLease()?.maintenanceLeaseId, 'maintenance-1');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('an expired authoritative lease blocks normal exit and requires explicit recovery', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities(), capabilities()],
    statusValues: [
      inactiveStatus(),
      activeStatus(),
      activeStatus([], undefined, undefined, 10 * 60_000, 'EXPIRED'),
    ],
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease),
    'LEASE_EXPIRED',
  );

  assert.equal(error.recoveryRequired, true);
  assert.equal(coordinator.getPendingLease()?.status, 'EXPIRED');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('a stale ACTIVE projection cannot release a lease whose local expiry has elapsed', async () => {
  const { coordinator, writes } = harness({
    now: 10_000,
    capabilityValues: [capabilities(), capabilities(), capabilities()],
    statusValues: [
      inactiveStatus(),
      activeStatus(),
      activeStatus([], undefined, undefined, 9_000, 'ACTIVE'),
    ],
  });

  const acquisition = await coordinator.acquire('openclaw-update');
  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease),
    'LEASE_EXPIRED',
  );

  assert.equal(error.recoveryRequired, true);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('explicit recovery may release an expired lease only after a fresh runtime check', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities()],
    statusValues: [
      activeStatus([], undefined, undefined, 10 * 60_000, 'EXPIRED'),
      activeStatus([], undefined, undefined, 10 * 60_000, 'EXPIRED'),
      inactiveStatus(),
    ],
  });

  const release = await coordinator.recover();

  assert.equal(release.released, true);
  assert.equal(coordinator.getPendingLease(), null);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.exit']);
});

test('a runtime that never reconnects times out without releasing maintenance', async () => {
  const { coordinator, writes } = harness({
    statusValues: [inactiveStatus(), activeStatus()],
    connected: false,
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease, { timeoutMs: 10, pollMs: 5 }),
    'RUNTIME_NOT_READY',
  );

  assert.equal(error.recoveryRequired, true);
  assert.equal(coordinator.getPendingLease()?.maintenanceLeaseId, 'maintenance-1');
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('database integrity failure after reconnect blocks exit', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [
      capabilities(),
      capabilities(),
      capabilities({ databaseIntegrity: 'page 7 is corrupt' }),
    ],
    statusValues: [inactiveStatus(), activeStatus()],
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const error = await expectMaintenanceError(
    coordinator.verifyAndRelease(acquisition.lease),
    'DATABASE_INTEGRITY_FAILED',
  );

  assert.equal(error.recoveryRequired, true);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.enter']);
});

test('an exit transport error is resolved only by an authoritative inactive status', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities(), capabilities()],
    statusValues: [inactiveStatus(), activeStatus(), activeStatus(), inactiveStatus()],
    exitError: new Error('socket closed after exit'),
  });
  const acquisition = await coordinator.acquire('openclaw-update');

  const release = await coordinator.verifyAndRelease(acquisition.lease);

  assert.equal(release.released, true);
  assert.equal(coordinator.getPendingLease(), null);
  assert.equal(writes.at(-1)?.method, 'junqi.collab.maintenance.exit');
});

test('explicit recovery can release a crash-surviving lease after fresh health checks', async () => {
  const { coordinator, writes } = harness({
    capabilityValues: [capabilities(), capabilities()],
    statusValues: [activeStatus(), activeStatus(), inactiveStatus()],
  });

  const release = await coordinator.recover();

  assert.equal(release.released, true);
  assert.deepEqual(writes.map((item) => item.method), ['junqi.collab.maintenance.exit']);
  assert.equal(writes[0].request.maintenanceLeaseId, 'maintenance-1');
  assert.equal(writes[0].request.healthVerified, true);
});

test('recovery refuses to release a lease owned by another Desktop', async () => {
  const { coordinator, writes } = harness({
    statusValues: [activeStatus([], 'junqi-desktop:other-owner')],
  });

  const error = await expectMaintenanceError(coordinator.recover(), 'LEASE_OWNER_MISMATCH');

  assert.equal(error.recoveryRequired, true);
  assert.equal(writes.length, 0);
});

test('unknown maintenance status blocks the operation instead of assuming no active runs', async () => {
  const { coordinator, writes } = harness({
    statusValues: [new Error('gateway request timed out')],
  });

  const error = await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'STATE_UNKNOWN');

  assert.equal(error.recoveryRequired, false);
  assert.equal(writes.length, 0);
});

test('contradictory or temporally invalid maintenance status fails closed before any write', async () => {
  const variants = [
    { ...inactiveStatus(), gateActive: true },
    { ...activeStatus(), status: 'EXPIRED', recoveryRequired: false },
    { ...activeStatus(), recoveryRequired: true },
    {
      active: true,
      gateActive: true,
      status: 'MALFORMED',
      recoveryRequired: true,
      lease: null,
      activeRuns: [],
      activeRunCount: 0,
      activeRunsTruncated: false,
    },
    { ...inactiveStatus(), activeRunCount: 1, activeRunsTruncated: false },
    { ...inactiveStatus([run()]), activeRunCount: 0 },
    { ...activeStatus(), lease: { ...lease(), enteredAt: null } },
    {
      ...activeStatus([], undefined, undefined, 2_000, 'EXPIRED'),
      lease: { ...lease(undefined, undefined, 2_000, 'EXPIRED'), expiredAt: 1_999 },
    },
  ];

  for (const status of variants) {
    const { coordinator, writes } = harness({ statusValues: [status] });
    await expectMaintenanceError(coordinator.acquire('openclaw-update'), 'STATE_UNKNOWN');
    assert.equal(writes.length, 0);
  }
});
