import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CollaborationCapabilityAgent,
  CollaborationRunSnapshot,
} from '@/types/collaboration';
import { buildAgentOfficeProjection } from '@/processing/agentOfficeProjection';

const NOW = Date.parse('2026-08-03T10:00:00Z');

function snapshot(): CollaborationRunSnapshot {
  return {
    runId: 'run-office',
    status: 'RUNNING',
    dispatchState: 'OPEN',
    archiveState: 'ACTIVE',
    reconcileState: 'IDLE',
    completionOutcome: null,
    revision: 7,
    lastEventSequence: 21,
    snapshotRevision: 7,
    goal: 'Prepare a release decision',
    origin: {
      runtimeId: 'runtime-1',
      agentId: 'main',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      nativeMessageId: 'message-1',
    },
    currentPlanRevisionId: 'plan-1',
    allowedActions: [],
    createdAt: NOW - 60_000,
    updatedAt: NOW,
    workItems: [
      {
        id: 'work-research',
        logicalId: 'research',
        planRevisionId: 'plan-1',
        title: 'Collect release evidence',
        status: 'RUNNING',
        assignedAgentId: 'researcher',
        inputScope: [],
        dependencies: [],
        requiredCapabilities: [],
        candidateAgentIds: ['researcher'],
        acceptanceCriteria: [],
        revision: 2,
        riskLevel: 'LOW',
        sideEffectClass: 'READ_ONLY',
      },
      {
        id: 'work-review',
        logicalId: 'review',
        planRevisionId: 'plan-1',
        title: 'Review release risk',
        status: 'BLOCKED',
        assignedAgentId: 'reviewer',
        inputScope: [],
        dependencies: ['research'],
        requiredCapabilities: [],
        candidateAgentIds: ['reviewer'],
        acceptanceCriteria: [],
        revision: 1,
        riskLevel: 'MEDIUM',
        sideEffectClass: 'READ_ONLY',
      },
    ],
    attempts: [
      {
        id: 'attempt-planner',
        kind: 'PLANNER',
        attemptNo: 1,
        status: 'SUCCEEDED',
        workerAgentId: 'main',
        revision: 2,
        startedAt: NOW - 50_000,
        endedAt: NOW - 45_000,
      },
      {
        id: 'attempt-research',
        workItemId: 'work-research',
        kind: 'WORKER',
        attemptNo: 1,
        status: 'RUNNING',
        workerAgentId: 'researcher',
        revision: 2,
        startedAt: NOW - 20_000,
      },
    ],
    interventions: [],
    deliveries: [],
  };
}

const AGENTS: CollaborationCapabilityAgent[] = [
  {
    id: 'main',
    name: 'Coordinator',
    runtimeType: 'native',
    allowed: true,
    coordinator: true,
  },
  {
    id: 'researcher',
    name: 'Research Agent',
    runtimeType: 'native',
    allowed: true,
    coordinator: false,
  },
  {
    id: 'reviewer',
    name: 'Review Agent',
    runtimeType: 'acp',
    allowed: true,
    coordinator: false,
  },
  {
    id: 'unused',
    name: 'Unused Agent',
    runtimeType: 'native',
    allowed: true,
    coordinator: false,
  },
];

test('projects only authoritative run participants into deterministic office desks', () => {
  const office = buildAgentOfficeProjection(snapshot(), AGENTS, 'main');

  assert.equal(office.officeId, 'run-office');
  assert.deepEqual(office.agents.map((agent) => agent.agentId), ['main', 'researcher', 'reviewer']);
  assert.deepEqual(office.agents.map((agent) => agent.deskId), [
    'coordination-desk-1',
    'active-desk-1',
    'waiting-desk-1',
  ]);
  assert.deepEqual(office.zones.map((zone) => [zone.id, zone.agentIds]), [
    ['coordination', ['main']],
    ['active', ['researcher']],
    ['waiting', ['reviewer']],
  ]);

  const researcher = office.agents.find((agent) => agent.agentId === 'researcher');
  assert.equal(researcher?.displayName, 'Research Agent');
  assert.equal(researcher?.state, 'ACTIVE');
  assert.equal(researcher?.currentWorkItem?.logicalId, 'research');
  assert.equal(researcher?.attempt?.id, 'attempt-research');

  const reviewer = office.agents.find((agent) => agent.agentId === 'reviewer');
  assert.equal(reviewer?.state, 'WAITING');
  assert.equal(reviewer?.runtimeType, 'acp');
  assert.equal(reviewer?.currentWorkItem?.logicalId, 'review');
  assert.equal(office.agents.some((agent) => agent.agentId === 'unused'), false);
});

test('keeps unknown attempts and unresolved interventions visible without claiming presence', () => {
  const value = snapshot();
  value.status = 'AWAITING_INTERVENTION';
  value.workItems[0] = { ...value.workItems[0]!, status: 'NEEDS_INTERVENTION' };
  value.attempts[1] = { ...value.attempts[1]!, status: 'UNKNOWN' };
  value.interventions = [{
    id: 'intervention-1',
    code: 'ATTEMPT_STATUS_UNKNOWN',
    entityRef: { type: 'attempt', id: 'attempt-research' },
    requiredAction: 'Reconcile the OpenClaw Task.',
    resumeStatus: 'RUNNING',
    createdAt: NOW,
  }];

  const office = buildAgentOfficeProjection(value, AGENTS, 'main');
  const researcher = office.agents.find((agent) => agent.agentId === 'researcher');

  assert.equal(researcher?.state, 'UNKNOWN');
  assert.equal(researcher?.zoneId, 'attention');
  assert.equal(researcher?.interventionCount, 1);
  assert.equal(researcher?.presence, 'NOT_PROJECTED');
  assert.match(researcher?.statusReason ?? '', /UNKNOWN/);
});

test('falls back to canonical ids when capability metadata is unavailable', () => {
  const office = buildAgentOfficeProjection(snapshot());

  assert.deepEqual(office.agents.map((agent) => agent.agentId), ['main', 'researcher', 'reviewer']);
  assert.equal(office.agents.find((agent) => agent.agentId === 'researcher')?.displayName, 'researcher');
  assert.equal(office.agents.every((agent) => agent.presence === 'NOT_PROJECTED'), true);
});

test('does not add a configured coordinator without run-level participation evidence', () => {
  const value = snapshot();
  value.attempts = value.attempts.filter((attempt) => attempt.kind === 'WORKER');

  const office = buildAgentOfficeProjection(value, AGENTS, 'main');

  assert.deepEqual(office.agents.map((agent) => agent.agentId), ['researcher', 'reviewer']);
  assert.equal(office.agents.some((agent) => agent.coordinator), false);
});
