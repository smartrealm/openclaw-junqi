import {
  ARCHIVE_STATES,
  ATTEMPT_KINDS,
  ATTEMPT_STATUSES,
  CHANNEL_STATUSES,
  COLLABORATION_SESSION_MUTATION_ACTIONS,
  COLLABORATION_SESSION_MUTATION_POLICIES,
  COLLABORATION_SESSION_MUTATION_STATUSES,
  COLLABORATION_SESSION_MUTATION_STRATEGIES,
  DELIVERY_REQUIREMENTS,
  DELIVERY_STATUSES,
  DISPATCH_STATES,
  RECONCILE_STATES,
  RISK_LEVELS,
  RUN_STATUSES,
  SIDE_EFFECT_CLASSES,
  TRANSCRIPT_STATUSES,
  WORK_ITEM_STATUSES,
  type CollaborationAttemptSnapshot,
  type CollaborationCapabilities,
  type CollaborationCapabilityAgent,
  type CollaborationDeletePreview,
  type CollaborationDeletionJob,
  type CollaborationDeliverySnapshot,
  type CollaborationEventsPage,
  type CollaborationEvent,
  type CollaborationExportArtifact,
  type CollaborationExportJob,
  type CollaborationFlowReconciliationBlocker,
  type CollaborationInterventionSnapshot,
  type CollaborationOriginRef,
  type CollaborationPartialPreview,
  type CollaborationReadMethod,
  type CollaborationReadParams,
  type CollaborationReadResponse,
  type CollaborationRunGetResponse,
  type CollaborationRunListResponse,
  type CollaborationRunReference,
  type CollaborationRunSnapshot,
  type CollaborationRunSummary,
  type CollaborationSessionMutationImpactResponse,
  type CollaborationWorkItemSnapshot,
  type CollaborationWorkflowTemplate,
  type CollaborationWorkflowTemplateDefinition,
  type CollaborationWorkflowTemplateLink,
  type CollaborationWorkflowTemplateListResponse,
  type CollaborationWriteResponse,
} from './types';

const MAX_COLLECTION_LENGTH = 10_000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

function cloneAndFreezeContractValue<T>(
  value: T,
  ancestors: WeakSet<object> = new WeakSet<object>(),
  path = 'params',
): T {
  if (value === null || typeof value !== 'object') {
    if (
      value === undefined
      || typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
    ) {
      return value;
    }
    throw new TypeError(`${path} must contain only JSON-compatible values`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain cycles`);

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!isArray && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only plain objects and arrays`);
  }

  ancestors.add(value);
  try {
    if (isArray) {
      const clone = value.map((entry, index) => (
        cloneAndFreezeContractValue(entry, ancestors, `${path}[${index}]`)
      ));
      return Object.freeze(clone) as unknown as T;
    }
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        cloneAndFreezeContractValue(entry, ancestors, `${path}.${key}`),
      ]),
    );
    return Object.freeze(clone) as T;
  } finally {
    ancestors.delete(value);
  }
}

export interface CollaborationReadBoundary<Method extends CollaborationReadMethod> {
  readonly transportParams: CollaborationReadParams<Method>;
  readonly expectation: CollaborationReadParams<Method>;
}

/**
 * Creates two immutable value snapshots so an async transport can never alter
 * the decoder expectation that authorizes its own response.
 */
export function createCollaborationReadBoundary<Method extends CollaborationReadMethod>(
  params: CollaborationReadParams<Method>,
): CollaborationReadBoundary<Method> {
  const source = cloneAndFreezeContractValue(params);
  return Object.freeze({
    transportParams: cloneAndFreezeContractValue(source),
    expectation: cloneAndFreezeContractValue(source),
  });
}

export class CollaborationWireError extends Error {
  constructor(
    public readonly path: string,
    expectation: string,
  ) {
    super(`${path} ${expectation}`);
    this.name = 'CollaborationWireError';
  }
}

function fail(path: string, expectation: string): never {
  throw new CollaborationWireError(path, expectation);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(path, 'must be a non-empty string');
  }
  return value;
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyString(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    fail(path, 'must be a lowercase SHA-256 hex digest');
  }
  return digest;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(path, 'must be a non-negative safe integer');
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    fail(path, `must be one of ${values.join(', ')}`);
  }
  return value as Values[number];
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyString(value, path);
}

function nullableInteger(value: unknown, path: string): number | null {
  return value === null ? null : integer(value, path);
}

function optionalString(
  source: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  return source[key] === undefined ? undefined : nonEmptyString(source[key], `${path}.${key}`);
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > MAX_COLLECTION_LENGTH) {
    fail(path, `must be an array with at most ${MAX_COLLECTION_LENGTH} entries`);
  }
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  const result = array(value, path).map((item, index) => nonEmptyString(item, `${path}[${index}]`));
  assertUnique(result, path, (item) => item);
  return result;
}

function recordArray(value: unknown, path: string): Array<Record<string, unknown>> {
  return array(value, path).map((item, index) => ({ ...record(item, `${path}[${index}]`) }));
}

function assertUnique<T>(
  values: readonly T[],
  path: string,
  keyOf: (value: T) => string | number,
): void {
  const seen = new Set<string | number>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) fail(path, `must not contain duplicate key ${String(key)}`);
    seen.add(key);
  }
}

function assertRunIdentity(
  source: Record<string, unknown>,
  expectedRunId: string,
  path: string,
): void {
  const runId = nonEmptyString(source.runId, `${path}.runId`);
  if (runId !== expectedRunId) fail(`${path}.runId`, `must equal ${expectedRunId}`);
}

function assertTimestampOrder(
  createdAt: number,
  updatedAt: number,
  path: string,
): void {
  if (updatedAt < createdAt) fail(`${path}.updatedAt`, 'must not precede createdAt');
}

function optionalNullableString(value: unknown, path: string): string | null | undefined {
  return value === undefined ? undefined : value === null ? null : nonEmptyString(value, path);
}

function aliasedField(
  source: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
  path: string,
): unknown {
  const hasCamelCase = Object.prototype.hasOwnProperty.call(source, camelCase)
    && source[camelCase] !== undefined;
  const hasSnakeCase = Object.prototype.hasOwnProperty.call(source, snakeCase)
    && source[snakeCase] !== undefined;
  if (hasCamelCase && hasSnakeCase && !Object.is(source[camelCase], source[snakeCase])) {
    fail(`${path}.${camelCase}`, `must not conflict with ${snakeCase}`);
  }
  return hasCamelCase ? source[camelCase] : hasSnakeCase ? source[snakeCase] : undefined;
}

function aliasedString(
  source: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
  path: string,
): string {
  return nonEmptyString(aliasedField(source, camelCase, snakeCase, path), `${path}.${camelCase}`);
}

function aliasedInteger(
  source: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
  path: string,
): number {
  return integer(aliasedField(source, camelCase, snakeCase, path), `${path}.${camelCase}`);
}

function aliasedNullableString(
  source: Record<string, unknown>,
  camelCase: string,
  snakeCase: string,
  path: string,
): string | null {
  return nullableString(aliasedField(source, camelCase, snakeCase, path), `${path}.${camelCase}`);
}

function assertDisjointStringArrays(
  collections: ReadonlyArray<readonly string[]>,
  path: string,
): void {
  const seen = new Set<string>();
  for (const collection of collections) {
    for (const value of collection) {
      if (seen.has(value)) fail(path, `must not classify ${value} more than once`);
      seen.add(value);
    }
  }
}

function assertStringArraySubset(
  values: readonly string[],
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const [index, value] of values.entries()) {
    if (!allowed.has(value)) fail(`${path}[${index}]`, 'must be included in the closure');
  }
}

function assertSameStringSet(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  const expectedSet = new Set(expected);
  if (actual.length !== expectedSet.size || actual.some((value) => !expectedSet.has(value))) {
    fail(path, 'must match the requested values');
  }
}

function decodeCapabilityAgent(value: unknown, index: number): CollaborationCapabilityAgent {
  const path = `response.configuredAgents[${index}]`;
  const source = record(value, path);
  const name = optionalString(source, 'name', path);
  const description = optionalString(source, 'description', path);
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(source.model !== undefined ? { model: source.model } : {}),
    runtimeType: enumeration(source.runtimeType, ['native', 'acp'] as const, `${path}.runtimeType`),
    allowed: boolean(source.allowed, `${path}.allowed`),
    coordinator: boolean(source.coordinator, `${path}.coordinator`),
  };
}

export function decodeCapabilities(value: unknown): CollaborationCapabilities {
  const response = record(value, 'response');
  const collaborationInstanceId = nonEmptyString(
    response.collaborationInstanceId,
    'response.collaborationInstanceId',
  );
  const pluginId = nonEmptyString(response.pluginId, 'response.pluginId');
  if (pluginId !== 'junqi-collab') fail('response.pluginId', 'must equal junqi-collab');
  const schemaVersion = integer(response.schemaVersion, 'response.schemaVersion');
  if (schemaVersion < 1) fail('response.schemaVersion', 'must be positive');
  const durableState = boolean(response.durableState, 'response.durableState');
  const durableRuntimeSource = record(response.durableRuntime, 'response.durableRuntime');
  const durableRuntimeDetails = {
    supported: boolean(durableRuntimeSource.supported, 'response.durableRuntime.supported'),
    required: boolean(durableRuntimeSource.required, 'response.durableRuntime.required'),
    reason: optionalNullableString(durableRuntimeSource.reason, 'response.durableRuntime.reason'),
  };
  const configuredAgents = array(response.configuredAgents, 'response.configuredAgents')
    .map((agent, index) => decodeCapabilityAgent(agent, index));
  assertUnique(configuredAgents, 'response.configuredAgents', (agent) => agent.id);
  if (configuredAgents.filter((agent) => agent.coordinator).length > 1) {
    fail('response.configuredAgents', 'must contain at most one coordinator');
  }
  const coordinatorAgentId = nullableString(response.coordinatorAgentId, 'response.coordinatorAgentId');
  const coordinator = coordinatorAgentId === null
    ? undefined
    : configuredAgents.find((agent) => agent.id === coordinatorAgentId && agent.coordinator);
  if (coordinatorAgentId !== null && !coordinator) {
    fail('response.coordinatorAgentId', 'must reference the configured coordinator');
  }
  const allowedAgentIds = stringArray(response.allowedAgentIds, 'response.allowedAgentIds');
  const actualAllowedIds = configuredAgents.filter((agent) => agent.allowed).map((agent) => agent.id);
  if (
    allowedAgentIds.length !== actualAllowedIds.length
    || allowedAgentIds.some((id) => !actualAllowedIds.includes(id))
  ) {
    fail('response.allowedAgentIds', 'must exactly match configured agents marked allowed');
  }
  const configured = boolean(response.configured, 'response.configured');
  if (configured !== Boolean(coordinator?.allowed && allowedAgentIds.length > 0)) {
    fail('response.configured', 'must agree with the effective coordinator and allowlist');
  }

  const featureNames = stringArray(response.features, 'response.features');
  const featureFlagsSource = record(response.featureFlags, 'response.featureFlags');
  const featureFlags: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(featureFlagsSource)) {
    if (!key.trim()) fail('response.featureFlags', 'must not contain an empty key');
    featureFlags[key] = boolean(flag, `response.featureFlags.${key}`);
  }
  const features = {
    ...Object.fromEntries(featureNames.map((feature) => [feature, true])),
    ...featureFlags,
  };

  const evidenceSource = record(response.featureEvidence, 'response.featureEvidence');
  if (evidenceSource.kind !== 'DECLARED_PLUGIN_CONTRACT') {
    fail('response.featureEvidence.kind', 'must equal DECLARED_PLUGIN_CONTRACT');
  }
  const featureEvidence = {
    kind: 'DECLARED_PLUGIN_CONTRACT' as const,
    behaviorVerified: boolean(
      evidenceSource.behaviorVerified,
      'response.featureEvidence.behaviorVerified',
    ),
    structuralChecks: {
      ...record(evidenceSource.structuralChecks, 'response.featureEvidence.structuralChecks'),
    },
    requiredBehaviorGate: nonEmptyString(
      evidenceSource.requiredBehaviorGate,
      'response.featureEvidence.requiredBehaviorGate',
    ),
  };

  const sessionSource = record(response.sessionCapabilities, 'response.sessionCapabilities');
  const workboardSource = record(response.workboard, 'response.workboard');
  const workboardReason = optionalNullableString(workboardSource.reason, 'response.workboard.reason');
  const maintenanceSource = record(response.maintenance, 'response.maintenance');
  const activeRuns = recordArray(maintenanceSource.activeRuns, 'response.maintenance.activeRuns');
  const activeRunIds = activeRuns.map((run, index) => nonEmptyString(
    run.runId,
    `response.maintenance.activeRuns[${index}].runId`,
  ));
  assertUnique(activeRunIds, 'response.maintenance.activeRuns', (runId) => runId);
  const activeRunCount = integer(
    maintenanceSource.activeRunCount,
    'response.maintenance.activeRunCount',
  );
  if (activeRunCount < activeRuns.length) {
    fail('response.maintenance.activeRunCount', 'must cover every returned active Run reference');
  }
  const activeRunsTruncated = boolean(
    maintenanceSource.activeRunsTruncated,
    'response.maintenance.activeRunsTruncated',
  );
  if (activeRunsTruncated !== (activeRunCount > activeRuns.length)) {
    fail('response.maintenance.activeRunsTruncated', 'must agree with activeRunCount');
  }
  const lease = maintenanceSource.lease === null
    ? null
    : { ...record(maintenanceSource.lease, 'response.maintenance.lease') };

  return {
    collaborationInstanceId,
    pluginId,
    pluginVersion: nonEmptyString(response.pluginVersion, 'response.pluginVersion'),
    schemaVersion,
    runtimeVersion: nonEmptyString(response.runtimeVersion, 'response.runtimeVersion'),
    databaseIntegrity: nonEmptyString(response.databaseIntegrity, 'response.databaseIntegrity'),
    configured,
    durableState,
    durableRuntime: durableRuntimeDetails.supported,
    durableRuntimeDetails,
    features,
    featureEvidence,
    configuredAgents,
    coordinatorAgentId,
    allowedAgentIds,
    repairs: stringArray(response.repairs, 'response.repairs'),
    trustTier: nonEmptyString(response.trustTier, 'response.trustTier'),
    workboard: {
      supported: boolean(workboardSource.supported, 'response.workboard.supported'),
      ...(workboardReason !== undefined ? { reason: workboardReason } : {}),
    },
    sessionCapabilities: {
      deleteExpectedSessionId: boolean(
        sessionSource.deleteExpectedSessionId,
        'response.sessionCapabilities.deleteExpectedSessionId',
      ),
      resetExpectedSessionId: boolean(
        sessionSource.resetExpectedSessionId,
        'response.sessionCapabilities.resetExpectedSessionId',
      ),
    },
    maintenance: {
      active: boolean(maintenanceSource.active, 'response.maintenance.active'),
      lease,
      activeRuns,
      activeRunCount,
      activeRunsTruncated,
    },
  };
}

export function decodeOrigin(value: unknown, path = 'origin'): CollaborationOriginRef {
  const source = record(value, path);
  const threadId = source.threadId;
  if (
    threadId !== undefined
    && !(typeof threadId === 'string' && threadId.trim().length > 0)
    && !(typeof threadId === 'number' && Number.isSafeInteger(threadId) && threadId >= 0)
  ) {
    fail(`${path}.threadId`, 'must be a non-empty string or a non-negative safe integer');
  }
  return {
    runtimeId: nonEmptyString(source.runtimeId, `${path}.runtimeId`),
    agentId: nonEmptyString(source.agentId, `${path}.agentId`),
    sessionKey: nonEmptyString(source.sessionKey, `${path}.sessionKey`),
    sessionId: nonEmptyString(source.sessionId, `${path}.sessionId`),
    nativeMessageId: nonEmptyString(source.nativeMessageId, `${path}.nativeMessageId`),
    ...(optionalString(source, 'clientMessageId', path) !== undefined
      ? { clientMessageId: optionalString(source, 'clientMessageId', path)! }
      : {}),
    ...(optionalString(source, 'channel', path) !== undefined
      ? { channel: optionalString(source, 'channel', path)! }
      : {}),
    ...(optionalString(source, 'accountId', path) !== undefined
      ? { accountId: optionalString(source, 'accountId', path)! }
      : {}),
    ...(optionalString(source, 'target', path) !== undefined
      ? { target: optionalString(source, 'target', path)! }
      : {}),
    ...(threadId !== undefined ? { threadId: threadId as string | number } : {}),
  };
}

function decodeRunSummary(
  value: unknown,
  path: string,
  lastEventSequenceValue?: unknown,
): CollaborationRunSummary {
  const source = record(value, path);
  const completionOutcome = source.completionOutcome;
  if (completionOutcome !== null && completionOutcome !== 'FULL' && completionOutcome !== 'PARTIAL') {
    fail(`${path}.completionOutcome`, 'must be FULL, PARTIAL, or null');
  }
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  return {
    runId: nonEmptyString(source.id, `${path}.id`),
    status: enumeration(source.status, RUN_STATUSES, `${path}.status`),
    dispatchState: enumeration(source.dispatchState, DISPATCH_STATES, `${path}.dispatchState`),
    archiveState: enumeration(source.archiveState, ARCHIVE_STATES, `${path}.archiveState`),
    reconcileState: enumeration(source.reconcileState, RECONCILE_STATES, `${path}.reconcileState`),
    completionOutcome,
    revision: integer(source.revision, `${path}.revision`),
    lastEventSequence: integer(
      lastEventSequenceValue === undefined ? source.lastEventSequence : lastEventSequenceValue,
      `${path}.lastEventSequence`,
    ),
    goal: nonEmptyString(source.goal, `${path}.goal`),
    origin: decodeOrigin(source.origin, `${path}.origin`),
    currentPlanRevisionId: nullableString(source.currentPlanRevisionId, `${path}.currentPlanRevisionId`),
    allowedActions: stringArray(source.allowedActions, `${path}.allowedActions`),
    createdAt,
    updatedAt,
  };
}

function decodeWorkItem(
  value: unknown,
  index: number,
  expectedRunId: string,
): CollaborationWorkItemSnapshot {
  const path = `snapshot.workItems[${index}]`;
  const source = record(value, path);
  assertRunIdentity(source, expectedRunId, path);
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    logicalId: nonEmptyString(source.logicalId, `${path}.logicalId`),
    planRevisionId: nonEmptyString(source.planRevisionId, `${path}.planRevisionId`),
    title: nonEmptyString(source.title, `${path}.title`),
    status: enumeration(source.status, WORK_ITEM_STATUSES, `${path}.status`),
    assignedAgentId: nullableString(source.assignedAgentId, `${path}.assignedAgentId`),
    inputScope: stringArray(source.inputScope, `${path}.inputScope`),
    dependencies: stringArray(source.dependencies, `${path}.dependencies`),
    requiredCapabilities: stringArray(source.requiredCapabilities, `${path}.requiredCapabilities`),
    candidateAgentIds: stringArray(source.candidateAgentIds, `${path}.candidateAgentIds`),
    acceptanceCriteria: stringArray(source.acceptanceCriteria, `${path}.acceptanceCriteria`),
    revision: integer(source.revision, `${path}.revision`),
    riskLevel: enumeration(source.riskLevel, RISK_LEVELS, `${path}.riskLevel`),
    sideEffectClass: enumeration(source.sideEffectClass, SIDE_EFFECT_CLASSES, `${path}.sideEffectClass`),
  };
}

function decodeAttempt(
  value: unknown,
  index: number,
  expectedRunId: string,
): CollaborationAttemptSnapshot {
  const path = `snapshot.attempts[${index}]`;
  const source = record(value, path);
  assertRunIdentity(source, expectedRunId, path);
  const startedAt = nullableInteger(source.startedAt, `${path}.startedAt`);
  const endedAt = nullableInteger(source.endedAt, `${path}.endedAt`);
  if (startedAt !== null && endedAt !== null && endedAt < startedAt) {
    fail(`${path}.endedAt`, 'must not precede startedAt');
  }
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  nonEmptyString(source.idempotencyKey, `${path}.idempotencyKey`);
  nonEmptyString(source.workerOwnerSessionKey, `${path}.workerOwnerSessionKey`);
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    workItemId: nullableString(source.workItemId, `${path}.workItemId`),
    kind: enumeration(source.kind, ATTEMPT_KINDS, `${path}.kind`),
    attemptNo: integer(source.attemptNo, `${path}.attemptNo`),
    status: enumeration(source.status, ATTEMPT_STATUSES, `${path}.status`),
    workerAgentId: nonEmptyString(source.workerAgentId, `${path}.workerAgentId`),
    executionRuntime: source.executionRuntime === undefined
      ? 'native'
      : enumeration(source.executionRuntime, ['native', 'acp'] as const, `${path}.executionRuntime`),
    executionTaskId: nullableString(source.executionTaskId, `${path}.executionTaskId`),
    agentRunId: nullableString(source.agentRunId, `${path}.agentRunId`),
    workerSessionKey: nonEmptyString(source.workerSessionKey, `${path}.workerSessionKey`),
    canAbandonWithResidualRisk: source.canAbandonWithResidualRisk === undefined
      ? false
      : boolean(source.canAbandonWithResidualRisk, `${path}.canAbandonWithResidualRisk`),
    revision: integer(source.revision, `${path}.revision`),
    startedAt,
    endedAt,
    lastError: nullableString(source.lastError, `${path}.lastError`),
  };
}

function decodeIntervention(
  value: unknown,
  index: number,
  expectedRunId: string,
): CollaborationInterventionSnapshot {
  const path = `snapshot.interventions[${index}]`;
  const source = record(value, path);
  assertRunIdentity(source, expectedRunId, path);
  const entityType = nullableString(source.entityType, `${path}.entityType`);
  const entityId = nullableString(source.entityId, `${path}.entityId`);
  if ((entityType === null) !== (entityId === null)) {
    fail(path, 'must provide entityType and entityId together');
  }
  const diagnostics = { ...record(source.diagnostics, `${path}.diagnostics`) };
  const resolvedAt = nullableInteger(source.resolvedAt, `${path}.resolvedAt`);
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  if (resolvedAt !== null && resolvedAt < createdAt) {
    fail(`${path}.resolvedAt`, 'must not precede createdAt');
  }
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    code: nonEmptyString(source.code, `${path}.code`),
    entityRef: entityType !== null && entityId !== null ? { type: entityType, id: entityId } : null,
    requiredAction: nonEmptyString(source.requiredAction, `${path}.requiredAction`),
    diagnostics,
    resumeStatus: enumeration(source.resumeStatus, RUN_STATUSES, `${path}.resumeStatus`),
    createdAt,
    resolvedAt,
  };
}

function decodeDelivery(
  value: unknown,
  index: number,
  expectedRunId: string,
): CollaborationDeliverySnapshot {
  const path = `snapshot.deliveries[${index}]`;
  const source = record(value, path);
  assertRunIdentity(source, expectedRunId, path);
  nonEmptyString(source.finalArtifactId, `${path}.finalArtifactId`);
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  return {
    id: nonEmptyString(source.id, `${path}.id`),
    targetRevision: integer(source.targetRevision, `${path}.targetRevision`),
    status: enumeration(source.status, DELIVERY_STATUSES, `${path}.status`),
    transcriptStatus: enumeration(source.transcriptStatus, TRANSCRIPT_STATUSES, `${path}.transcriptStatus`),
    channelStatus: enumeration(source.channelStatus, CHANNEL_STATUSES, `${path}.channelStatus`),
    requirement: enumeration(source.requirement, DELIVERY_REQUIREMENTS, `${path}.requirement`),
    revision: integer(source.revision, `${path}.revision`),
    target: decodeOrigin(source.target, `${path}.target`),
    messageId: nullableString(source.messageId, `${path}.messageId`),
  };
}

function decodeOwnedRecords(
  value: unknown,
  path: string,
  expectedRunId: string,
): Array<Record<string, unknown>> {
  const values = recordArray(value, path);
  for (const [index, item] of values.entries()) {
    nonEmptyString(item.id, `${path}[${index}].id`);
    assertRunIdentity(item, expectedRunId, `${path}[${index}]`);
  }
  assertUnique(values, path, (item) => String(item.id));
  return values;
}

function decodeWorkflowTemplateDefinition(
  value: unknown,
  path: string,
): CollaborationWorkflowTemplateDefinition {
  const source = record(value, path);
  const workItems = array(source.workItems, `${path}.workItems`).map((item, index) => {
    const itemPath = `${path}.workItems[${index}]`;
    const workItem = record(item, itemPath);
    if (Object.prototype.hasOwnProperty.call(workItem, 'candidateAgentIds')) {
      fail(`${itemPath}.candidateAgentIds`, 'must not persist Agent assignment candidates');
    }
    return {
      id: nonEmptyString(workItem.id, `${itemPath}.id`),
      title: nonEmptyString(workItem.title, `${itemPath}.title`),
      dependencies: stringArray(workItem.dependencies, `${itemPath}.dependencies`),
    };
  });
  if (workItems.length === 0) fail(`${path}.workItems`, 'must not be empty');
  assertUnique(workItems, `${path}.workItems`, (item) => item.id);
  const synthesis = record(source.synthesis, `${path}.synthesis`);
  return {
    schemaVersion: integer(source.schemaVersion, `${path}.schemaVersion`),
    goal: nonEmptyString(source.goal, `${path}.goal`),
    workItems,
    synthesis: {
      requiredEvidence: stringArray(synthesis.requiredEvidence, `${path}.synthesis.requiredEvidence`),
      finalAnswerContract: nonEmptyString(
        synthesis.finalAnswerContract,
        `${path}.synthesis.finalAnswerContract`,
      ),
    },
  };
}

function decodeWorkflowTemplate(value: unknown, index: number): CollaborationWorkflowTemplate {
  const path = `response.templates[${index}]`;
  const source = record(value, path);
  const status = nonEmptyString(source.status, `${path}.status`);
  if (status !== 'PUBLISHED') fail(`${path}.status`, 'must be PUBLISHED');
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  const versionPath = `${path}.currentVersion`;
  const currentVersion = record(source.currentVersion, versionPath);
  const templateId = nonEmptyString(source.id, `${path}.id`);
  const versionTemplateId = nonEmptyString(currentVersion.templateId, `${versionPath}.templateId`);
  if (versionTemplateId !== templateId) {
    fail(`${versionPath}.templateId`, 'must match the template id');
  }
  const versionNo = integer(currentVersion.versionNo, `${versionPath}.versionNo`);
  if (versionNo < 1) fail(`${versionPath}.versionNo`, 'must be at least 1');
  return {
    id: templateId,
    name: nonEmptyString(source.name, `${path}.name`),
    status: 'PUBLISHED',
    sourceRunId: nullableString(source.sourceRunId, `${path}.sourceRunId`),
    createdBy: nonEmptyString(source.createdBy, `${path}.createdBy`),
    createdAt,
    updatedAt,
    currentVersion: {
      id: nonEmptyString(currentVersion.id, `${versionPath}.id`),
      templateId,
      versionNo,
      digest: sha256Hex(currentVersion.digest, `${versionPath}.digest`),
      sourceRunId: nullableString(currentVersion.sourceRunId, `${versionPath}.sourceRunId`),
      sourcePlanRevisionId: nullableString(
        currentVersion.sourcePlanRevisionId,
        `${versionPath}.sourcePlanRevisionId`,
      ),
      createdBy: nonEmptyString(currentVersion.createdBy, `${versionPath}.createdBy`),
      createdAt: integer(currentVersion.createdAt, `${versionPath}.createdAt`),
      definition: decodeWorkflowTemplateDefinition(currentVersion.definition, `${versionPath}.definition`),
    },
  };
}

function decodeWorkflowTemplateLink(value: unknown): CollaborationWorkflowTemplateLink | null {
  if (value === null || value === undefined) return null;
  const path = 'response.snapshot.workflowTemplate';
  const source = record(value, path);
  const templateVersionNo = integer(source.templateVersionNo, `${path}.templateVersionNo`);
  if (templateVersionNo < 1) fail(`${path}.templateVersionNo`, 'must be at least 1');
  return {
    templateId: nonEmptyString(source.templateId, `${path}.templateId`),
    templateVersionId: nonEmptyString(source.templateVersionId, `${path}.templateVersionId`),
    templateName: nonEmptyString(source.templateName, `${path}.templateName`),
    templateVersionNo,
    templateDigest: sha256Hex(source.templateDigest, `${path}.templateDigest`),
    parameterDigest: sha256Hex(source.parameterDigest, `${path}.parameterDigest`),
    instantiatedAt: integer(source.instantiatedAt, `${path}.instantiatedAt`),
  };
}

function decodeWorkflowTemplateList(
  value: unknown,
  _expected: { limit?: number },
): CollaborationWorkflowTemplateListResponse {
  const response = record(value, 'response');
  const templates = array(response.templates, 'response.templates')
    .map((template, index) => decodeWorkflowTemplate(template, index));
  assertUnique(templates, 'response.templates', (template) => template.id);
  return {
    collaborationInstanceId: nonEmptyString(
      response.collaborationInstanceId,
      'response.collaborationInstanceId',
    ),
    templates,
  };
}

export function decodeRunGetResponse(
  value: unknown,
  expectedRunId: string,
): CollaborationRunGetResponse {
  const response = record(value, 'response');
  const collaborationInstanceId = nonEmptyString(
    response.collaborationInstanceId,
    'response.collaborationInstanceId',
  );
  const source = record(response.snapshot, 'response.snapshot');
  const nestedInstanceId = nonEmptyString(
    source.collaborationInstanceId,
    'response.snapshot.collaborationInstanceId',
  );
  if (nestedInstanceId !== collaborationInstanceId) {
    fail('response.snapshot.collaborationInstanceId', 'must match the response instance identity');
  }
  const lastEventSequence = integer(source.lastEventSequence, 'response.snapshot.lastEventSequence');
  const summary = decodeRunSummary(source.run, 'response.snapshot.run', lastEventSequence);
  if (summary.runId !== expectedRunId) {
    fail('response.snapshot.run.id', `must equal requested run ${expectedRunId}`);
  }
  const snapshotRevision = integer(response.snapshotRevision, 'response.snapshotRevision');
  if (snapshotRevision !== summary.revision) {
    fail('response.snapshotRevision', 'must equal the authoritative run revision');
  }

  const workItems = array(source.workItems, 'response.snapshot.workItems')
    .map((item, index) => decodeWorkItem(item, index, summary.runId));
  const attempts = array(source.attempts, 'response.snapshot.attempts')
    .map((item, index) => decodeAttempt(item, index, summary.runId));
  const interventions = array(source.interventions, 'response.snapshot.interventions')
    .map((item, index) => decodeIntervention(item, index, summary.runId));
  const deliveries = array(source.deliveries, 'response.snapshot.deliveries')
    .map((item, index) => decodeDelivery(item, index, summary.runId));
  assertUnique(workItems, 'response.snapshot.workItems', (item) => item.id);
  assertUnique(attempts, 'response.snapshot.attempts', (item) => item.id);
  assertUnique(interventions, 'response.snapshot.interventions', (item) => item.id);
  assertUnique(deliveries, 'response.snapshot.deliveries', (item) => item.id);
  assertUnique(deliveries, 'response.snapshot.deliveries.targetRevision', (item) => item.targetRevision);

  const planRevisions = decodeOwnedRecords(
    source.planRevisions,
    'response.snapshot.planRevisions',
    summary.runId,
  );
  const revisionNumbers = planRevisions.map((plan, index) => integer(
    plan.revisionNo,
    `response.snapshot.planRevisions[${index}].revisionNo`,
  ));
  assertUnique(revisionNumbers, 'response.snapshot.planRevisions.revisionNo', (revision) => revision);
  if (
    summary.currentPlanRevisionId !== null
    && !planRevisions.some((revision) => revision.id === summary.currentPlanRevisionId)
  ) {
    fail('response.snapshot.run.currentPlanRevisionId', 'must reference a returned plan revision');
  }
  const planIds = new Set(planRevisions.map((revision) => String(revision.id)));
  for (const [index, item] of workItems.entries()) {
    if (!planIds.has(item.planRevisionId)) {
      fail(`response.snapshot.workItems[${index}].planRevisionId`, 'must reference a returned plan revision');
    }
  }

  const evidence = decodeOwnedRecords(source.evidence, 'response.snapshot.evidence', summary.runId);
  const decisions = decodeOwnedRecords(source.decisions, 'response.snapshot.decisions', summary.runId);
  const workflowTemplate = decodeWorkflowTemplateLink(source.workflowTemplate);
  const finalArtifact = source.finalArtifact === null
    ? null
    : { ...record(source.finalArtifact, 'response.snapshot.finalArtifact') };
  if (finalArtifact) {
    nonEmptyString(finalArtifact.id, 'response.snapshot.finalArtifact.id');
    assertRunIdentity(finalArtifact, summary.runId, 'response.snapshot.finalArtifact');
  }

  const snapshot: CollaborationRunSnapshot = {
    ...summary,
    snapshotRevision,
    workItems,
    attempts,
    interventions,
    deliveries,
    planRevisions,
    evidence,
    decisions,
    workflowTemplate,
    finalArtifact,
  };
  return { collaborationInstanceId, snapshot };
}

export interface DecodeRunListOptions {
  paginated: boolean;
  expectedSession?: { sessionKey: string; sessionId: string };
}

export function decodeRunListResponse(
  value: unknown,
  options: DecodeRunListOptions,
): CollaborationRunListResponse {
  const response = record(value, 'response');
  const collaborationInstanceId = nonEmptyString(
    response.collaborationInstanceId,
    'response.collaborationInstanceId',
  );
  if (options.expectedSession) {
    if (nonEmptyString(response.sessionKey, 'response.sessionKey') !== options.expectedSession.sessionKey) {
      fail('response.sessionKey', 'must match the requested session');
    }
    if (nonEmptyString(response.sessionId, 'response.sessionId') !== options.expectedSession.sessionId) {
      fail('response.sessionId', 'must match the requested session');
    }
  }
  const runs = array(response.runs, 'response.runs')
    .map((run, index) => decodeRunSummary(run, `response.runs[${index}]`));
  assertUnique(runs, 'response.runs', (run) => run.runId);
  const snapshotRevision = integer(response.snapshotRevision, 'response.snapshotRevision');
  const lastSequence = integer(response.lastSequence, 'response.lastSequence');
  if (runs.some((run) => run.revision > snapshotRevision)) {
    fail('response.snapshotRevision', 'must cover every returned run revision');
  }
  if (runs.some((run) => run.lastEventSequence > lastSequence)) {
    fail('response.lastSequence', 'must cover every returned run event sequence');
  }

  let nextCursor: string | null = null;
  if (options.paginated) {
    if (response.nextCursor !== null) {
      const cursor = nonEmptyString(response.nextCursor, 'response.nextCursor');
      if (cursor.length > 512 || !CURSOR_PATTERN.test(cursor)) {
        fail('response.nextCursor', 'must be a bounded opaque base64url token or null');
      }
      nextCursor = cursor;
    }
  } else if (response.nextCursor !== undefined) {
    fail('response.nextCursor', 'must be omitted for a session-scoped run list');
  }

  return {
    collaborationInstanceId,
    runs,
    nextCursor,
    snapshotRevision,
  };
}

function decodeEvent(
  value: unknown,
  index: number,
  expectedRunId: string,
): CollaborationEvent {
  const path = `response.events[${index}]`;
  const source = record(value, path);
  assertRunIdentity(source, expectedRunId, path);
  const entityType = optionalString(source, 'entityType', path);
  const entityId = optionalString(source, 'entityId', path);
  if ((entityType === undefined) !== (entityId === undefined)) {
    fail(path, 'must provide entityType and entityId together');
  }
  return {
    sequence: integer(source.sequence, `${path}.sequence`),
    runId: expectedRunId,
    eventType: nonEmptyString(source.eventType, `${path}.eventType`),
    ...(entityType !== undefined ? { entityType } : {}),
    ...(entityId !== undefined ? { entityId } : {}),
    runRevision: integer(source.runRevision, `${path}.runRevision`),
    payload: { ...record(source.payload, `${path}.payload`) },
    createdAt: integer(source.createdAt, `${path}.createdAt`),
  };
}

export function decodeEventsPage(
  value: unknown,
  expected: { runId: string; afterSequence: number },
): CollaborationEventsPage {
  const response = record(value, 'response');
  const collaborationInstanceId = nonEmptyString(
    response.collaborationInstanceId,
    'response.collaborationInstanceId',
  );
  const runId = nonEmptyString(response.runId, 'response.runId');
  if (runId !== expected.runId) fail('response.runId', 'must match the requested run');
  const events = array(response.events, 'response.events')
    .map((event, index) => decodeEvent(event, index, runId));
  let priorSequence = expected.afterSequence;
  for (const [index, event] of events.entries()) {
    if (event.sequence <= priorSequence) {
      fail(`response.events[${index}].sequence`, 'must be strictly increasing after the requested cursor');
    }
    priorSequence = event.sequence;
  }
  const nextSequence = integer(response.nextSequence, 'response.nextSequence');
  if (nextSequence !== priorSequence) {
    fail('response.nextSequence', 'must equal the last returned event sequence or requested cursor');
  }
  const lastSequence = integer(response.lastSequence, 'response.lastSequence');
  if (lastSequence < nextSequence) fail('response.lastSequence', 'must not precede nextSequence');
  const snapshotRevision = integer(response.snapshotRevision, 'response.snapshotRevision');
  if (events.some((event) => event.runRevision > snapshotRevision)) {
    fail('response.snapshotRevision', 'must cover every returned event revision');
  }
  const hasMore = boolean(response.hasMore, 'response.hasMore');
  const cursorInvalid = response.cursorInvalid === undefined
    ? undefined
    : boolean(response.cursorInvalid, 'response.cursorInvalid');
  const cursorInvalidReason = optionalString(response, 'cursorInvalidReason', 'response');
  if (cursorInvalidReason !== undefined && cursorInvalid !== true) {
    fail('response.cursorInvalidReason', 'requires cursorInvalid=true');
  }
  return {
    collaborationInstanceId,
    runId,
    events,
    nextSequence,
    lastSequence,
    hasMore,
    snapshotRevision,
    ...(cursorInvalid !== undefined ? { cursorInvalid } : {}),
    ...(cursorInvalidReason !== undefined ? { cursorInvalidReason } : {}),
  };
}

function decodePreviewBase(
  value: unknown,
  expectedRunId: string,
): {
  source: Record<string, unknown>;
  runId: string;
  runRevision: number;
  expiresAt: number;
  confirmationToken: string;
} {
  const source = record(value, 'response');
  const runId = nonEmptyString(source.runId, 'response.runId');
  if (runId !== expectedRunId) fail('response.runId', 'must match the requested run');
  return {
    source,
    runId,
    runRevision: integer(source.runRevision, 'response.runRevision'),
    expiresAt: integer(source.expiresAt, 'response.expiresAt'),
    confirmationToken: nonEmptyString(source.confirmationToken, 'response.confirmationToken'),
  };
}

function decodeFlowReconciliationBlocker(value: unknown): CollaborationFlowReconciliationBlocker {
  const path = 'response.flowReconciliationBlocker';
  const source = record(value, path);
  return {
    commandId: nonEmptyString(source.commandId, `${path}.commandId`),
    commandStatus: nonEmptyString(source.commandStatus, `${path}.commandStatus`),
    flowId: nullableString(source.flowId, `${path}.flowId`),
    flowRevision: nullableInteger(source.flowRevision, `${path}.flowRevision`),
    diagnostic: nullableString(source.diagnostic, `${path}.diagnostic`),
  };
}

export function decodePartialPreview(
  value: unknown,
  expected: { runId: string; workItemIds: string[] },
): CollaborationPartialPreview {
  const base = decodePreviewBase(value, expected.runId);
  const requestedWorkItemIds = stringArray(expected.workItemIds, 'request.workItemIds');
  if (requestedWorkItemIds.length === 0) fail('request.workItemIds', 'must not be empty');
  const closureSource = record(base.source.closure, 'response.closure');
  const waiveIds = stringArray(closureSource.waiveIds, 'response.closure.waiveIds');
  const blockedDescendantIds = stringArray(
    closureSource.blockedDescendantIds,
    'response.closure.blockedDescendantIds',
  );
  const activeIds = stringArray(closureSource.activeIds, 'response.closure.activeIds');
  assertDisjointStringArrays([waiveIds, blockedDescendantIds], 'response.closure');
  assertStringArraySubset(
    activeIds,
    new Set([...waiveIds, ...blockedDescendantIds]),
    'response.closure.activeIds',
  );
  assertSameStringSet(waiveIds, requestedWorkItemIds, 'response.closure.waiveIds');
  return {
    runId: base.runId,
    runRevision: base.runRevision,
    closure: { waiveIds, blockedDescendantIds, activeIds },
    expiresAt: base.expiresAt,
    confirmationToken: base.confirmationToken,
  };
}

export function decodeDeletePreview(
  value: unknown,
  expected: { runId: string },
): CollaborationDeletePreview {
  const base = decodePreviewBase(value, expected.runId);
  const blocker = base.source.flowReconciliationBlocker === undefined
    ? undefined
    : decodeFlowReconciliationBlocker(base.source.flowReconciliationBlocker);
  return {
    runId: base.runId,
    runRevision: base.runRevision,
    digest: sha256Hex(base.source.digest, 'response.digest'),
    expiresAt: base.expiresAt,
    confirmationToken: base.confirmationToken,
    ...(blocker ? { flowReconciliationBlocker: blocker } : {}),
  };
}

export function decodeDeletionJob(
  value: unknown,
  expected: { jobId: string; expectedRunId: string },
): CollaborationDeletionJob {
  const source = record(value, 'response');
  const id = nonEmptyString(source.id, 'response.id');
  if (id !== expected.jobId) fail('response.id', 'must match the requested deletion job');
  const runId = aliasedString(source, 'runId', 'run_id', 'response');
  if (runId !== expected.expectedRunId) {
    fail('response.runId', 'must match the run bound to the deletion receipt');
  }
  const createdAt = aliasedInteger(source, 'createdAt', 'created_at', 'response');
  const updatedAt = aliasedInteger(source, 'updatedAt', 'updated_at', 'response');
  assertTimestampOrder(createdAt, updatedAt, 'response');
  const status = enumeration(
    source.status,
    ['PENDING', 'FAILED', 'PARTIAL', 'COMPLETED'] as const,
    'response.status',
  );
  const confirmationDigest = sha256Hex(
    aliasedField(source, 'confirmationDigest', 'confirmation_digest', 'response'),
    'response.confirmationDigest',
  );
  const lastError = aliasedNullableString(source, 'lastError', 'last_error', 'response');
  if ((status === 'PENDING' || status === 'COMPLETED') && lastError !== null) {
    fail('response.lastError', `${status} requires a null diagnostic`);
  }
  if ((status === 'FAILED' || status === 'PARTIAL') && lastError === null) {
    fail('response.lastError', `${status} requires a diagnostic`);
  }
  return {
    id,
    runId,
    status,
    confirmationDigest,
    lastError,
    createdAt,
    updatedAt,
  };
}

export function decodeExportJob(
  value: unknown,
  expected: { jobId: string; expectedRunId: string },
): CollaborationExportJob {
  const source = record(value, 'response');
  const id = nonEmptyString(source.id, 'response.id');
  if (id !== expected.jobId) fail('response.id', 'must match the requested export job');
  const runId = aliasedString(source, 'runId', 'run_id', 'response');
  if (runId !== expected.expectedRunId) {
    fail('response.runId', 'must match the run bound to the export receipt');
  }
  const status = enumeration(
    source.status,
    ['PENDING', 'FAILED', 'COMPLETED'] as const,
    'response.status',
  );
  const artifactPath = aliasedNullableString(source, 'artifactPath', 'artifact_path', 'response');
  const digest = source.digest === null
    ? null
    : sha256Hex(source.digest, 'response.digest');
  const lastError = aliasedNullableString(source, 'lastError', 'last_error', 'response');
  if ((artifactPath === null) !== (digest === null)) {
    fail('response.status', 'artifactPath and digest must be present or absent together');
  }
  if (status === 'PENDING' && (artifactPath !== null || digest !== null || lastError !== null)) {
    fail('response.status', 'PENDING forbids artifact evidence and diagnostics');
  }
  if (status === 'FAILED' && lastError === null) {
    fail('response.lastError', 'FAILED requires a diagnostic');
  }
  if (status === 'COMPLETED') {
    if (artifactPath === null || digest === null) {
      fail('response.status', 'COMPLETED requires artifactPath and digest');
    }
    if (lastError !== null) fail('response.lastError', 'COMPLETED requires a null diagnostic');
  }
  const createdAt = aliasedInteger(source, 'createdAt', 'created_at', 'response');
  const updatedAt = aliasedInteger(source, 'updatedAt', 'updated_at', 'response');
  assertTimestampOrder(createdAt, updatedAt, 'response');
  return {
    id,
    runId,
    status,
    format: enumeration(source.format, ['json'] as const, 'response.format'),
    artifactPath,
    digest,
    lastError,
    createdAt,
    updatedAt,
  };
}

const MAX_EXPORT_CONTENT_BYTES = 16 * 1024 * 1024;

export function decodeExportArtifact(
  value: unknown,
  expected: { jobId: string; expectedDigest: string },
): CollaborationExportArtifact {
  const source = record(value, 'response');
  const jobId = nonEmptyString(source.jobId, 'response.jobId');
  if (jobId !== expected.jobId) fail('response.jobId', 'must match the requested export job');
  const content = nonEmptyString(source.content, 'response.content');
  if (new TextEncoder().encode(content).byteLength > MAX_EXPORT_CONTENT_BYTES) {
    fail('response.content', `must not exceed ${MAX_EXPORT_CONTENT_BYTES} UTF-8 bytes`);
  }
  try {
    const parsed = JSON.parse(content) as unknown;
    record(parsed, 'response.content JSON');
  } catch (error) {
    if (error instanceof CollaborationWireError) throw error;
    fail('response.content', 'must contain valid JSON object content');
  }
  const digest = sha256Hex(source.digest, 'response.digest');
  if (digest !== expected.expectedDigest) {
    fail('response.digest', 'must match the completed export job digest');
  }
  return {
    jobId,
    format: enumeration(source.format, ['json'] as const, 'response.format'),
    digest,
    content,
  };
}

function decodeSessionMutationRunReferenceFields(
  value: unknown,
  index: number,
): { source: Record<string, unknown>; reference: CollaborationRunReference } {
  const path = `response.activeRuns[${index}]`;
  const source = record(value, path);
  const completionOutcome = source.completionOutcome;
  if (completionOutcome !== null && completionOutcome !== 'FULL' && completionOutcome !== 'PARTIAL') {
    fail(`${path}.completionOutcome`, 'must be FULL, PARTIAL, or null');
  }
  const currentPlanRevisionId = source.currentPlanRevisionId === null
    ? null
    : nonEmptyString(source.currentPlanRevisionId, `${path}.currentPlanRevisionId`);
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  const reference: CollaborationRunReference = {
    runId: aliasedString(source, 'runId', 'id', path),
    status: enumeration(source.status, RUN_STATUSES, `${path}.status`),
    dispatchState: enumeration(source.dispatchState, DISPATCH_STATES, `${path}.dispatchState`),
    archiveState: enumeration(source.archiveState, ARCHIVE_STATES, `${path}.archiveState`),
    reconcileState: enumeration(source.reconcileState, RECONCILE_STATES, `${path}.reconcileState`),
    completionOutcome,
    revision: integer(source.revision, `${path}.revision`),
    origin: decodeOrigin(source.origin, `${path}.origin`),
    currentPlanRevisionId,
    createdAt,
    updatedAt,
  };
  return { source, reference };
}

export function decodeSessionMutationRunSummary(
  value: unknown,
  index: number,
): CollaborationRunSummary {
  const { source, reference } = decodeSessionMutationRunReferenceFields(value, index);
  const path = `response.activeRuns[${index}]`;
  return {
    ...reference,
    lastEventSequence: source.lastEventSequence === undefined
      ? 0
      : integer(source.lastEventSequence, `${path}.lastEventSequence`),
    goal: nonEmptyString(source.goal, `${path}.goal`),
    allowedActions: stringArray(source.allowedActions, `${path}.allowedActions`),
  };
}

/** Decode the intentionally slim active-run projection returned by write RPCs. */
export function decodeSessionMutationRunReference(
  value: unknown,
  index: number,
): CollaborationRunReference {
  return decodeSessionMutationRunReferenceFields(value, index).reference;
}

function decodeActiveSessionMutation(value: unknown): CollaborationSessionMutationImpactResponse['activeMutation'] {
  if (value === null) return null;
  const path = 'response.activeMutation';
  const source = record(value, path);
  const createdAt = integer(source.createdAt, `${path}.createdAt`);
  const updatedAt = integer(source.updatedAt, `${path}.updatedAt`);
  assertTimestampOrder(createdAt, updatedAt, path);
  const expiresAt = integer(source.expiresAt, `${path}.expiresAt`);
  if (expiresAt < createdAt) fail(`${path}.expiresAt`, 'must not precede createdAt');
  const result = source.result === null
    ? null
    : { ...record(source.result, `${path}.result`) };
  const action = enumeration(
    source.action,
    COLLABORATION_SESSION_MUTATION_ACTIONS,
    `${path}.action`,
  );
  const policy = enumeration(
    source.policy,
    COLLABORATION_SESSION_MUTATION_POLICIES,
    `${path}.policy`,
  );
  if (policy === 'STOP_AND_RETARGET_LATER' && action !== 'delete') {
    fail(`${path}.policy`, 'STOP_AND_RETARGET_LATER requires action=delete');
  }
  return {
    mutationId: nonEmptyString(source.mutationId, `${path}.mutationId`),
    runtimeId: nonEmptyString(source.runtimeId, `${path}.runtimeId`),
    sessionKey: nonEmptyString(source.sessionKey, `${path}.sessionKey`),
    sessionId: nonEmptyString(source.sessionId, `${path}.sessionId`),
    action,
    policy,
    status: enumeration(
      source.status,
      COLLABORATION_SESSION_MUTATION_STATUSES,
      `${path}.status`,
    ),
    expiresAt,
    result,
    createdAt,
    updatedAt,
  };
}

export function decodeSessionMutationImpact(
  value: unknown,
  expected: {
    runtimeId: string;
    sessionKey: string;
    sessionId: string;
    action: CollaborationReadParams<'junqi.collab.session.mutationImpact'>['action'];
  },
): CollaborationSessionMutationImpactResponse {
  const source = record(value, 'response');
  const runtimeId = nonEmptyString(source.runtimeId, 'response.runtimeId');
  const sessionKey = nonEmptyString(source.sessionKey, 'response.sessionKey');
  const sessionId = nonEmptyString(source.sessionId, 'response.sessionId');
  const action = enumeration(
    source.action,
    COLLABORATION_SESSION_MUTATION_ACTIONS,
    'response.action',
  );
  if (runtimeId !== expected.runtimeId) fail('response.runtimeId', 'must match the requested runtime');
  if (sessionKey !== expected.sessionKey) fail('response.sessionKey', 'must match the requested session');
  if (sessionId !== expected.sessionId) fail('response.sessionId', 'must match the requested session');
  if (action !== expected.action) fail('response.action', 'must match the requested mutation action');

  const activeRunsSource = array(source.activeRuns, 'response.activeRuns');
  if (activeRunsSource.length > 100) fail('response.activeRuns', 'must contain at most 100 entries');
  const activeRuns = activeRunsSource.map((run, index) => decodeSessionMutationRunSummary(run, index));
  assertUnique(activeRuns, 'response.activeRuns', (run) => run.runId);
  for (const [index, run] of activeRuns.entries()) {
    if (
      run.origin.runtimeId !== runtimeId
      || run.origin.sessionKey !== sessionKey
      || run.origin.sessionId !== sessionId
    ) {
      fail(`response.activeRuns[${index}].origin`, 'must match the requested runtime session');
    }
  }

  const activeMutation = decodeActiveSessionMutation(source.activeMutation);
  if (activeMutation && (
    activeMutation.runtimeId !== runtimeId
    || activeMutation.sessionKey !== sessionKey
    || activeMutation.sessionId !== sessionId
    || activeMutation.action !== action
  )) {
    fail('response.activeMutation', 'must match the requested runtime session and action');
  }

  const strategies = array(source.strategies, 'response.strategies').map((strategy, index) => (
    enumeration(
      strategy,
      COLLABORATION_SESSION_MUTATION_STRATEGIES,
      `response.strategies[${index}]`,
    )
  ));
  if (strategies.length === 0) fail('response.strategies', 'must not be empty');
  assertUnique(strategies, 'response.strategies', (strategy) => strategy);

  const runtimeMatches = boolean(source.runtimeMatches, 'response.runtimeMatches');
  if (!runtimeMatches) fail('response.runtimeMatches', 'must be true for the requested runtime');
  const blocked = boolean(source.blocked, 'response.blocked');
  if (blocked !== (activeRuns.length > 0)) {
    fail('response.blocked', 'must agree with activeRuns');
  }
  const mutationFenceActive = boolean(source.mutationFenceActive, 'response.mutationFenceActive');
  if (mutationFenceActive !== Boolean(activeMutation)) {
    fail('response.mutationFenceActive', 'must agree with activeMutation');
  }
  const recoveryRequired = boolean(source.recoveryRequired, 'response.recoveryRequired');
  if (recoveryRequired !== (activeMutation?.status === 'EXPIRED')) {
    fail('response.recoveryRequired', 'must agree with activeMutation.status');
  }
  if (
    (recoveryRequired && (strategies.length !== 1 || strategies[0] !== 'RECOVER'))
    || (!recoveryRequired && strategies.includes('RECOVER'))
  ) {
    fail('response.strategies', 'must agree with recoveryRequired');
  }
  const coreRpcAllowed = boolean(source.coreRpcAllowed, 'response.coreRpcAllowed');
  if (coreRpcAllowed && (
    activeMutation?.status !== 'PREPARED'
    || (activeRuns.length > 0 && activeMutation.policy !== 'STOP_AND_RETARGET_LATER')
  )) {
    fail('response.coreRpcAllowed', 'requires an authoritative PREPARED mutation fence');
  }
  return {
    runtimeId,
    sessionKey,
    sessionId,
    action,
    activeRuns,
    activeMutation,
    blocked,
    runtimeMatches: true,
    mutationFenceActive,
    recoveryRequired,
    coreRpcAllowed,
    resetCasSupported: boolean(source.resetCasSupported, 'response.resetCasSupported'),
    strategies,
  };
}

type CollaborationReadDecoderRegistry = {
  [Method in CollaborationReadMethod]: (
    value: unknown,
    params: CollaborationReadParams<Method>,
  ) => CollaborationReadResponse<Method>;
};

const COLLABORATION_READ_DECODERS = {
  'junqi.collab.workflow.template.list': decodeWorkflowTemplateList,
  'junqi.collab.run.partial.preview': decodePartialPreview,
  'junqi.collab.run.delete.preview': decodeDeletePreview,
  'junqi.collab.run.delete.get': decodeDeletionJob,
  'junqi.collab.export.get': decodeExportJob,
  'junqi.collab.export.download': decodeExportArtifact,
  'junqi.collab.session.mutationImpact': decodeSessionMutationImpact,
} satisfies CollaborationReadDecoderRegistry;

/** Exhaustive Strategy registry for operational collaboration read contracts. */
export function decodeCollaborationReadResponse<Method extends CollaborationReadMethod>(
  method: Method,
  value: unknown,
  params: CollaborationReadParams<Method>,
): CollaborationReadResponse<Method> {
  const decoder = COLLABORATION_READ_DECODERS[method] as (
    raw: unknown,
    expected: CollaborationReadParams<Method>,
  ) => CollaborationReadResponse<Method>;
  return decoder(value, params);
}

export function decodeWriteResponse(
  value: unknown,
  expectedCommandId: string,
  expectedCollaborationInstanceId: string,
): CollaborationWriteResponse {
  const response = record(value, 'response');
  if (response.accepted !== true) fail('response.accepted', 'must be true for a successful RPC');
  const replayed = boolean(response.replayed, 'response.replayed');
  const commandId = nonEmptyString(response.commandId, 'response.commandId');
  if (commandId !== expectedCommandId) fail('response.commandId', 'must match the submitted command');
  const collaborationInstanceId = nonEmptyString(
    response.collaborationInstanceId,
    'response.collaborationInstanceId',
  );
  if (collaborationInstanceId !== expectedCollaborationInstanceId) {
    fail(
      'response.collaborationInstanceId',
      'must match the submitted expectedCollaborationInstanceId',
    );
  }
  const runId = optionalString(response, 'runId', 'response');
  const newRunRevision = response.newRunRevision === undefined
    ? undefined
    : integer(response.newRunRevision, 'response.newRunRevision');
  const newEntityRevision = response.newEntityRevision === undefined
    ? undefined
    : integer(response.newEntityRevision, 'response.newEntityRevision');
  const lastEventSequence = response.lastEventSequence === undefined
    ? undefined
    : integer(response.lastEventSequence, 'response.lastEventSequence');
  return {
    ...response,
    accepted: true,
    replayed,
    commandId,
    collaborationInstanceId,
    ...(runId !== undefined ? { runId } : {}),
    ...(newRunRevision !== undefined ? { newRunRevision } : {}),
    ...(newEntityRevision !== undefined ? { newEntityRevision } : {}),
    ...(lastEventSequence !== undefined ? { lastEventSequence } : {}),
  };
}
