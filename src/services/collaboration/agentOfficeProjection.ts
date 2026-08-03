import type {
  CollaborationAttemptSnapshot,
  CollaborationCapabilityAgent,
  CollaborationInterventionSnapshot,
  CollaborationRunSnapshot,
  CollaborationWorkItemSnapshot,
} from './types';

export const AGENT_OFFICE_ZONE_IDS = [
  'coordination',
  'active',
  'waiting',
  'attention',
  'completed',
] as const;

export type AgentOfficeZoneId = (typeof AGENT_OFFICE_ZONE_IDS)[number];
export type AgentOfficeAgentState =
  | 'COORDINATING'
  | 'ACTIVE'
  | 'WAITING'
  | 'ATTENTION'
  | 'UNKNOWN'
  | 'COMPLETED'
  | 'IDLE';

export interface AgentOfficeAgentProjection {
  agentId: string;
  displayName: string;
  runtimeType?: CollaborationCapabilityAgent['runtimeType'];
  coordinator: boolean;
  presence: 'NOT_PROJECTED';
  state: AgentOfficeAgentState;
  statusReason: string;
  zoneId: AgentOfficeZoneId;
  deskId: string;
  currentWorkItem: CollaborationWorkItemSnapshot | null;
  workItemCount: number;
  completedWorkItemCount: number;
  attempt: CollaborationAttemptSnapshot | null;
  interventionCount: number;
}

export interface AgentOfficeZoneProjection {
  id: AgentOfficeZoneId;
  agentIds: string[];
}

export interface AgentOfficeProjection {
  officeId: string;
  agents: AgentOfficeAgentProjection[];
  zones: AgentOfficeZoneProjection[];
}

const ACTIVE_ATTEMPT_STATUSES = new Set<CollaborationAttemptSnapshot['status']>([
  'CREATED',
  'DISPATCHING',
  'RUNNING',
  'CANCELLING',
]);
const TERMINAL_WORK_ITEM_STATUSES = new Set<CollaborationWorkItemSnapshot['status']>([
  'SUCCEEDED',
  'CANCELLED',
  'WAIVED',
]);

function latestAttempt(
  attempts: readonly CollaborationAttemptSnapshot[],
): CollaborationAttemptSnapshot | null {
  return [...attempts].sort((left, right) => {
    const leftActive = ACTIVE_ATTEMPT_STATUSES.has(left.status) || left.status === 'UNKNOWN';
    const rightActive = ACTIVE_ATTEMPT_STATUSES.has(right.status) || right.status === 'UNKNOWN';
    if (leftActive !== rightActive) return leftActive ? -1 : 1;
    const leftTime = left.startedAt ?? left.endedAt ?? 0;
    const rightTime = right.startedAt ?? right.endedAt ?? 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    if (left.attemptNo !== right.attemptNo) return right.attemptNo - left.attemptNo;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

function interventionTargetsAgent(
  intervention: CollaborationInterventionSnapshot,
  agentId: string,
  workItemIds: ReadonlySet<string>,
  attemptIds: ReadonlySet<string>,
  coordinator: boolean,
): boolean {
  if (intervention.resolvedAt != null) return false;
  const ref = intervention.entityRef;
  if (!ref) return coordinator;
  const type = ref.type.toLowerCase();
  if (type.includes('agent')) return ref.id === agentId;
  if (type.includes('attempt')) return attemptIds.has(ref.id);
  if (type.includes('work')) return workItemIds.has(ref.id);
  if (type.includes('run')) return coordinator;
  return false;
}

function selectCurrentWorkItem(
  items: readonly CollaborationWorkItemSnapshot[],
  attempt: CollaborationAttemptSnapshot | null,
): CollaborationWorkItemSnapshot | null {
  if (attempt?.workItemId) {
    const attempted = items.find((item) => item.id === attempt.workItemId || item.logicalId === attempt.workItemId);
    if (attempted) return attempted;
  }
  return [...items].sort((left, right) => {
    const leftTerminal = TERMINAL_WORK_ITEM_STATUSES.has(left.status);
    const rightTerminal = TERMINAL_WORK_ITEM_STATUSES.has(right.status);
    if (leftTerminal !== rightTerminal) return leftTerminal ? 1 : -1;
    if (left.revision !== right.revision) return right.revision - left.revision;
    return left.logicalId.localeCompare(right.logicalId);
  })[0] ?? null;
}

function resolveAgentState(input: {
  coordinator: boolean;
  attempt: CollaborationAttemptSnapshot | null;
  currentWorkItem: CollaborationWorkItemSnapshot | null;
  interventionCount: number;
  workItems: readonly CollaborationWorkItemSnapshot[];
}): Pick<AgentOfficeAgentProjection, 'state' | 'zoneId' | 'statusReason'> {
  const { coordinator, attempt, currentWorkItem, interventionCount, workItems } = input;
  if (attempt?.status === 'UNKNOWN') {
    return { state: 'UNKNOWN', zoneId: 'attention', statusReason: 'ATTEMPT_UNKNOWN' };
  }
  if (interventionCount > 0 || currentWorkItem?.status === 'NEEDS_INTERVENTION') {
    return {
      state: 'ATTENTION',
      zoneId: 'attention',
      statusReason: currentWorkItem?.status ?? 'INTERVENTION_OPEN',
    };
  }
  if (attempt && ACTIVE_ATTEMPT_STATUSES.has(attempt.status)) {
    return {
      state: coordinator ? 'COORDINATING' : 'ACTIVE',
      zoneId: coordinator ? 'coordination' : 'active',
      statusReason: `ATTEMPT_${attempt.status}`,
    };
  }
  if (currentWorkItem && ['PLANNED', 'BLOCKED', 'READY'].includes(currentWorkItem.status)) {
    return { state: 'WAITING', zoneId: 'waiting', statusReason: currentWorkItem.status };
  }
  if (workItems.length > 0 && workItems.every((item) => TERMINAL_WORK_ITEM_STATUSES.has(item.status))) {
    return { state: 'COMPLETED', zoneId: 'completed', statusReason: 'WORK_ITEMS_SETTLED' };
  }
  if (coordinator) {
    return { state: 'COORDINATING', zoneId: 'coordination', statusReason: 'COORDINATOR_ASSIGNED' };
  }
  return { state: 'IDLE', zoneId: 'waiting', statusReason: 'NO_ACTIVE_WORK' };
}

/**
 * Builds a read-only spatial projection from the canonical collaboration
 * snapshot. Desk and zone placement never grants orchestration authority and
 * does not claim that a configured Agent is online.
 */
export function buildAgentOfficeProjection(
  snapshot: CollaborationRunSnapshot,
  configuredAgents: readonly CollaborationCapabilityAgent[] = [],
  coordinatorAgentId: string | null = null,
): AgentOfficeProjection {
  const capabilityById = new Map(configuredAgents.map((agent) => [agent.id, agent]));
  const participantIds = new Set<string>();
  for (const item of snapshot.workItems) {
    if (item.assignedAgentId) participantIds.add(item.assignedAgentId);
  }
  for (const attempt of snapshot.attempts) participantIds.add(attempt.workerAgentId);
  const attemptedCoordinatorId = snapshot.attempts.find((attempt) => (
    attempt.kind === 'PLANNER' || attempt.kind === 'SYNTHESIZER'
  ))?.workerAgentId;
  const effectiveCoordinatorId = attemptedCoordinatorId
    ?? (coordinatorAgentId && participantIds.has(coordinatorAgentId) ? coordinatorAgentId : null);

  const agents = [...participantIds].sort((left, right) => {
    if (left === effectiveCoordinatorId) return -1;
    if (right === effectiveCoordinatorId) return 1;
    return left.localeCompare(right);
  }).map((agentId) => {
    const capability = capabilityById.get(agentId);
    const coordinator = agentId === effectiveCoordinatorId;
    const workItems = snapshot.workItems.filter((item) => item.assignedAgentId === agentId);
    const attempts = snapshot.attempts.filter((attempt) => attempt.workerAgentId === agentId);
    const attempt = latestAttempt(attempts);
    const currentWorkItem = selectCurrentWorkItem(workItems, attempt);
    const workItemIds = new Set(workItems.flatMap((item) => [item.id, item.logicalId]));
    const attemptIds = new Set(attempts.map((candidate) => candidate.id));
    const interventionCount = snapshot.interventions.filter((intervention) => (
      interventionTargetsAgent(intervention, agentId, workItemIds, attemptIds, coordinator)
    )).length;
    const state = resolveAgentState({ coordinator, attempt, currentWorkItem, interventionCount, workItems });

    return {
      agentId,
      displayName: capability?.name?.trim() || agentId,
      ...(capability ? { runtimeType: capability.runtimeType } : {}),
      coordinator,
      presence: 'NOT_PROJECTED' as const,
      ...state,
      deskId: '',
      currentWorkItem,
      workItemCount: workItems.length,
      completedWorkItemCount: workItems.filter((item) => TERMINAL_WORK_ITEM_STATUSES.has(item.status)).length,
      attempt,
      interventionCount,
    };
  });

  const counters = new Map<AgentOfficeZoneId, number>();
  for (const agent of agents) {
    const next = (counters.get(agent.zoneId) ?? 0) + 1;
    counters.set(agent.zoneId, next);
    agent.deskId = `${agent.zoneId}-desk-${next}`;
  }

  return {
    officeId: snapshot.runId,
    agents,
    zones: AGENT_OFFICE_ZONE_IDS.flatMap((id) => {
      const agentIds = agents.filter((agent) => agent.zoneId === id).map((agent) => agent.agentId);
      return agentIds.length > 0 ? [{ id, agentIds }] : [];
    }),
  };
}
