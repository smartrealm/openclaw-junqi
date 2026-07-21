import {
  collaborationClient,
  CollaborationClientError,
  createCollaborationWriteRequest,
  type CollaborationClient,
} from './client';
import {
  CollaborationWireError,
  createCollaborationReadBoundary,
  decodeCollaborationReadResponse,
} from './wire-codec';
import type {
  CollaborationDeletePreview as CollaborationDeletePreviewContract,
  CollaborationDeliverySnapshot,
  CollaborationDeletionJobStatus,
  CollaborationFlowReconciliationBlocker as CollaborationFlowReconciliationBlockerContract,
  CollaborationOriginRef,
  CollaborationPartialPreview as CollaborationPartialPreviewContract,
  CollaborationReadMethod,
  CollaborationReadParams,
  CollaborationReadResponse,
  CollaborationRunSnapshot,
  CollaborationWorkItemSnapshot,
  CollaborationWriteMethod,
  CollaborationWriteRequest,
  CollaborationWriteResponse,
} from './types';

export const COLLABORATION_RUN_ACTIONS = [
  'PLAN_REVISE',
  'PLAN_APPROVE',
  'CANCEL',
  'DISPATCH_STOP',
  'DISPATCH_RESUME',
  'WORK_ITEM_INPUT_APPEND',
  'WORK_ITEM_CANCEL',
  'WORK_ITEM_RETRY',
  'WORK_ITEM_REASSIGN',
  'ATTEMPT_RESOLVE_UNKNOWN',
  'PARTIAL',
  'RECONCILE',
  'DELIVERY_RETRY',
  'DELIVERY_RETARGET',
  'DELIVERY_ABANDON',
  'EXPORT',
  'CLONE',
  'ARCHIVE',
  'UNARCHIVE',
  'DELETE',
] as const;

export type CollaborationRunAction = (typeof COLLABORATION_RUN_ACTIONS)[number];

export const ATTEMPT_UNKNOWN_RESOLUTIONS = [
  'RUNNING',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'ABANDONED',
] as const;

export type CollaborationAttemptUnknownResolution = (typeof ATTEMPT_UNKNOWN_RESOLUTIONS)[number];

const DELIVERY_RETRY_STATUSES = new Set(['RETRY_REQUIRED', 'UNKNOWN']);
const DELIVERY_RETARGET_STATUSES = new Set(['PREPARED', 'RETRY_REQUIRED', 'UNKNOWN']);

function latestDeliveryId(snapshot: CollaborationRunSnapshot): string | null {
  return snapshot.deliveries.reduce<CollaborationDeliverySnapshot | null>(
    (latest, delivery) => !latest || delivery.targetRevision > latest.targetRevision ? delivery : latest,
    null,
  )?.id ?? null;
}

export function deliveryCanRetry(
  snapshot: CollaborationRunSnapshot,
  delivery: CollaborationDeliverySnapshot,
): boolean {
  return delivery.id === latestDeliveryId(snapshot) && DELIVERY_RETRY_STATUSES.has(delivery.status);
}

export function deliveryCanRetargetOrAbandon(
  snapshot: CollaborationRunSnapshot,
  delivery: CollaborationDeliverySnapshot,
): boolean {
  return delivery.id === latestDeliveryId(snapshot) && DELIVERY_RETARGET_STATUSES.has(delivery.status);
}

export function deliveryTargetsSameSession(
  delivery: CollaborationDeliverySnapshot,
  target: CollaborationOriginRef,
): boolean {
  const current = delivery.target;
  return current.runtimeId === target.runtimeId
    && current.agentId === target.agentId
    && current.sessionKey === target.sessionKey
    && current.sessionId === target.sessionId;
}

/** Conservative UI projection. The server remains the transactional authority. */
export function resolutionsForUnknownAttempt(
  run: Pick<CollaborationRunSnapshot, 'status' | 'allowedActions'>,
  attempt: CollaborationRunSnapshot['attempts'][number] | null | undefined,
): readonly CollaborationAttemptUnknownResolution[] {
  if (
    attempt?.status !== 'UNKNOWN'
    || !isRunActionAllowed(run, 'ATTEMPT_RESOLVE_UNKNOWN')
  ) {
    return [];
  }

  return ATTEMPT_UNKNOWN_RESOLUTIONS.filter((resolution) => {
    if (resolution === 'RUNNING') return Boolean(attempt.agentRunId);
    if (resolution === 'ABANDONED') return attempt.canAbandonWithResidualRisk === true;
    return true;
  });
}

export type CollaborationPartialPreview = CollaborationPartialPreviewContract;
export type CollaborationDeletePreview = CollaborationDeletePreviewContract;
export type CollaborationFlowReconciliationBlocker =
  CollaborationFlowReconciliationBlockerContract;

export type CollaborationRunActionPreview = CollaborationPartialPreview | CollaborationDeletePreview;

export type CollaborationRunActionSubmission =
  | { action: 'PLAN_REVISE'; instruction: string }
  | { action: 'PLAN_APPROVE'; assignments: Record<string, string> }
  | { action: 'CANCEL' }
  | { action: 'DISPATCH_STOP' }
  | { action: 'DISPATCH_RESUME' }
  | { action: 'WORK_ITEM_INPUT_APPEND'; workItemId: string; content: string }
  | { action: 'WORK_ITEM_CANCEL'; workItemId: string; confirmed: boolean }
  | { action: 'WORK_ITEM_RETRY'; workItemId: string }
  | { action: 'WORK_ITEM_REASSIGN'; workItemId: string; agentId: string }
  | {
      action: 'ATTEMPT_RESOLVE_UNKNOWN';
      attemptId: string;
      resolution: CollaborationAttemptUnknownResolution;
      acceptResidualRisk?: boolean;
    }
  | {
      action: 'PARTIAL';
      workItemIds: string[];
      preview?: CollaborationPartialPreview;
    }
  | { action: 'RECONCILE' }
  | { action: 'DELIVERY_RETRY'; deliveryId: string }
  | { action: 'DELIVERY_RETARGET'; deliveryId: string; target: CollaborationOriginRef }
  | { action: 'DELIVERY_ABANDON'; deliveryId: string; confirmed: boolean }
  | { action: 'EXPORT' }
  | { action: 'CLONE'; goal?: string }
  | { action: 'ARCHIVE' }
  | { action: 'UNARCHIVE' }
  | {
      action: 'DELETE';
      preview?: CollaborationDeletePreview;
      confirmed: boolean;
      abandonFlowReconciliation?: boolean;
      abandonmentReason?: string;
    };

export interface BuiltCollaborationRunAction {
  action: CollaborationRunAction;
  method: CollaborationWriteMethod;
  request: CollaborationWriteRequest;
}

export type CollaborationRunActionErrorCode =
  | 'ACTION_NOT_ALLOWED'
  | 'INVALID_ACTION_INPUT'
  | 'INVALID_ACTION_RESPONSE'
  | 'ENTITY_NOT_FOUND'
  | 'PREVIEW_REQUIRED'
  | 'PREVIEW_STALE'
  | 'CONFIRMATION_REQUIRED';

export class CollaborationRunActionError extends Error {
  constructor(
    public readonly code: CollaborationRunActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CollaborationRunActionError';
  }
}

export interface CollaborationActionReadCall {
  (method: 'junqi.collab.run.partial.preview' | 'junqi.collab.run.delete.preview', params: Record<string, unknown>): Promise<unknown>;
}

export interface CollaborationExportCall {
  (
    method: 'junqi.collab.export.get' | 'junqi.collab.export.download',
    params: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface CollaborationActionWriteClient {
  write: CollaborationClient['write'];
}

const ACTION_METHODS: Record<CollaborationRunAction, CollaborationWriteMethod> = {
  PLAN_REVISE: 'junqi.collab.plan.revise',
  PLAN_APPROVE: 'junqi.collab.plan.approve',
  CANCEL: 'junqi.collab.run.cancel',
  DISPATCH_STOP: 'junqi.collab.run.dispatch.stop',
  DISPATCH_RESUME: 'junqi.collab.run.dispatch.resume',
  WORK_ITEM_INPUT_APPEND: 'junqi.collab.workItem.input.append',
  WORK_ITEM_CANCEL: 'junqi.collab.workItem.cancel',
  WORK_ITEM_RETRY: 'junqi.collab.workItem.retry',
  WORK_ITEM_REASSIGN: 'junqi.collab.workItem.reassign',
  ATTEMPT_RESOLVE_UNKNOWN: 'junqi.collab.attempt.resolveUnknown',
  PARTIAL: 'junqi.collab.run.partial.accept',
  RECONCILE: 'junqi.collab.run.reconcile',
  DELIVERY_RETRY: 'junqi.collab.delivery.retry',
  DELIVERY_RETARGET: 'junqi.collab.delivery.retarget',
  DELIVERY_ABANDON: 'junqi.collab.delivery.abandon',
  EXPORT: 'junqi.collab.export.create',
  CLONE: 'junqi.collab.run.clone',
  ARCHIVE: 'junqi.collab.run.archive',
  UNARCHIVE: 'junqi.collab.run.unarchive',
  DELETE: 'junqi.collab.run.delete',
};

const ACTIONS_REQUIRING_DIALOG = new Set<CollaborationRunAction>([
  'PLAN_REVISE',
  'PLAN_APPROVE',
  'CANCEL',
  'WORK_ITEM_INPUT_APPEND',
  'WORK_ITEM_CANCEL',
  'WORK_ITEM_RETRY',
  'WORK_ITEM_REASSIGN',
  'ATTEMPT_RESOLVE_UNKNOWN',
  'PARTIAL',
  'DELIVERY_RETRY',
  'DELIVERY_RETARGET',
  'DELIVERY_ABANDON',
  'DELETE',
  'CLONE',
]);

export function isCollaborationRunAction(value: string): value is CollaborationRunAction {
  return (COLLABORATION_RUN_ACTIONS as readonly string[]).includes(value);
}

export function isRunActionAllowed(
  run: Pick<CollaborationRunSnapshot, 'allowedActions'>,
  action: string,
): action is CollaborationRunAction {
  return isCollaborationRunAction(action) && run.allowedActions.includes(action);
}

export function runActionRequiresDialog(action: CollaborationRunAction): boolean {
  return ACTIONS_REQUIRING_DIALOG.has(action);
}

function fail(code: CollaborationRunActionErrorCode, message: string): never {
  throw new CollaborationRunActionError(code, message);
}

function assertAllowed(snapshot: CollaborationRunSnapshot, action: CollaborationRunAction): void {
  if (!isRunActionAllowed(snapshot, action)) {
    fail('ACTION_NOT_ALLOWED', `${action} is not allowed by run ${snapshot.runId}`);
  }
}

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) fail('INVALID_ACTION_INPUT', `${field} is required`);
  return normalized;
}

function requireSafeRevision(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_ACTION_INPUT', `${field} must be a non-negative integer`);
  }
  return value;
}

function collaborationWirePath(error: unknown): string | null {
  if (error instanceof CollaborationWireError) return error.path;
  if (
    error instanceof CollaborationClientError
    && error.code === 'INVALID_RESPONSE'
    && typeof error.details?.path === 'string'
  ) {
    return error.details.path;
  }
  return null;
}

function collaborationWireMessage(error: unknown): string | null {
  if (error instanceof CollaborationWireError) return error.message;
  if (
    error instanceof CollaborationClientError
    && error.originalError instanceof CollaborationWireError
  ) {
    return error.originalError.message;
  }
  return null;
}

function rethrowActionReadError(method: CollaborationReadMethod, error: unknown): never {
  const path = collaborationWirePath(error);
  if (
    path === 'response.runId'
    && (method === 'junqi.collab.run.partial.preview' || method === 'junqi.collab.run.delete.preview')
  ) {
    fail('PREVIEW_STALE', 'The server confirmation preview belongs to another run');
  }
  if (
    method === 'junqi.collab.run.partial.preview'
    && path === 'response.closure.waiveIds'
    && collaborationWireMessage(error)?.includes('must match the requested values')
  ) {
    fail('PREVIEW_STALE', 'The server preview does not match the selected work items');
  }
  if (path !== null) {
    fail('INVALID_ACTION_RESPONSE', `${method} returned an invalid response at ${path}`);
  }
  throw error;
}

function decodeActionRead<Method extends CollaborationReadMethod>(
  method: Method,
  value: unknown,
  params: CollaborationReadParams<Method>,
): CollaborationReadResponse<Method> {
  try {
    return decodeCollaborationReadResponse(method, value, params);
  } catch (error) {
    return rethrowActionReadError(method, error);
  }
}

async function readActionContract<Method extends CollaborationReadMethod>(
  method: Method,
  params: CollaborationReadParams<Method>,
  rawRead: ((method: Method, params: CollaborationReadParams<Method>) => Promise<unknown>) | undefined,
  typedRead: (
    params: CollaborationReadParams<Method>,
  ) => Promise<CollaborationReadResponse<Method>>,
): Promise<CollaborationReadResponse<Method>> {
  const boundary = createCollaborationReadBoundary(params);
  try {
    if (rawRead) {
      const response = await rawRead(method, boundary.transportParams);
      return decodeCollaborationReadResponse(method, response, boundary.expectation);
    }
    return await typedRead(boundary.transportParams);
  } catch (error) {
    return rethrowActionReadError(method, error);
  }
}

/** Shared confirmation specification used by both the dialog and request builder. */
export function deleteConfirmationReady(
  preview: CollaborationDeletePreview,
  confirmation: {
    confirmed: boolean;
    abandonFlowReconciliation?: boolean;
    abandonmentReason?: string;
  },
): boolean {
  if (!confirmation.confirmed) return false;
  if (!preview.flowReconciliationBlocker) return true;
  return confirmation.abandonFlowReconciliation === true
    && typeof confirmation.abandonmentReason === 'string'
    && Boolean(confirmation.abandonmentReason.trim());
}

function requireWorkItem(snapshot: CollaborationRunSnapshot, workItemId: string): CollaborationWorkItemSnapshot {
  const item = snapshot.workItems.find((candidate) => candidate.id === workItemId);
  if (!item) fail('ENTITY_NOT_FOUND', `Work item ${workItemId} is not present in the run snapshot`);
  return item;
}

const ACTIVE_ATTEMPT_STATUSES = new Set([
  'CREATED',
  'DISPATCHING',
  'RUNNING',
  'CANCELLING',
  'UNKNOWN',
]);
const WORK_ITEM_INPUT_STATUSES = new Set(['BLOCKED', 'READY', 'NEEDS_INTERVENTION', 'CANCELLED']);
const WORK_ITEM_CANCEL_STATUSES = new Set(['BLOCKED', 'READY', 'DISPATCHING', 'RUNNING', 'NEEDS_INTERVENTION']);

export function workItemHasActiveAttempt(
  snapshot: CollaborationRunSnapshot,
  workItemId: string,
): boolean {
  return snapshot.attempts.some(
    (attempt) => attempt.workItemId === workItemId && ACTIVE_ATTEMPT_STATUSES.has(attempt.status),
  );
}

export function workItemAcceptsAdditionalInput(
  snapshot: CollaborationRunSnapshot,
  item: CollaborationWorkItemSnapshot,
): boolean {
  return WORK_ITEM_INPUT_STATUSES.has(item.status) && !workItemHasActiveAttempt(snapshot, item.id);
}

export function workItemCanBeCancelled(item: CollaborationWorkItemSnapshot): boolean {
  return WORK_ITEM_CANCEL_STATUSES.has(item.status);
}

function requireDelivery(snapshot: CollaborationRunSnapshot, deliveryId: string): CollaborationDeliverySnapshot {
  const delivery = snapshot.deliveries.find((candidate) => candidate.id === deliveryId);
  if (!delivery) fail('ENTITY_NOT_FOUND', `Delivery ${deliveryId} is not present in the run snapshot`);
  return delivery;
}

function requireUnknownAttempt(
  snapshot: CollaborationRunSnapshot,
  attemptId: string,
): CollaborationRunSnapshot['attempts'][number] {
  const attempt = snapshot.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) fail('ENTITY_NOT_FOUND', `Attempt ${attemptId} is not present in the run snapshot`);
  if (attempt.status !== 'UNKNOWN') {
    fail('INVALID_ACTION_INPUT', `Attempt ${attemptId} no longer has an unknown outcome`);
  }
  return attempt;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

/**
 * Candidate agents are owned by the approved plan. They are intentionally read
 * from the server snapshot rather than inferred from the current agent list.
 */
export function candidateAgentIdsForWorkItem(
  snapshot: CollaborationRunSnapshot,
  workItem: CollaborationWorkItemSnapshot,
): string[] {
  const direct = stringArray(workItem.candidateAgentIds);
  if (direct.length > 0) return direct;

  for (const revision of snapshot.planRevisions ?? []) {
    const plan = asRecord(revision.plan);
    const items = Array.isArray(plan?.workItems) ? plan.workItems : [];
    const match = items
      .map(asRecord)
      .find((item) => item?.id === workItem.logicalId);
    const candidates = stringArray(match?.candidateAgentIds);
    if (candidates.length > 0) return candidates;
  }
  return [];
}

function validateAssignments(
  snapshot: CollaborationRunSnapshot,
  assignments: Record<string, string>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const item of snapshot.workItems) {
    const agentId = assignments[item.logicalId];
    if (typeof agentId !== 'string' || !agentId.trim()) {
      fail('INVALID_ACTION_INPUT', `An agent assignment is required for ${item.logicalId}`);
    }
    const candidates = candidateAgentIdsForWorkItem(snapshot, item);
    if (candidates.length === 0) {
      fail('INVALID_ACTION_INPUT', `The approved agent candidates for ${item.logicalId} are unavailable`);
    }
    if (!candidates.includes(agentId)) {
      fail('INVALID_ACTION_INPUT', `${agentId} is not an approved candidate for ${item.logicalId}`);
    }
    normalized[item.logicalId] = agentId;
  }
  return normalized;
}

function validateOrigin(target: CollaborationOriginRef): CollaborationOriginRef {
  return {
    runtimeId: requireNonEmpty(target.runtimeId, 'target.runtimeId'),
    agentId: requireNonEmpty(target.agentId, 'target.agentId'),
    sessionKey: requireNonEmpty(target.sessionKey, 'target.sessionKey'),
    sessionId: requireNonEmpty(target.sessionId, 'target.sessionId'),
    nativeMessageId: requireNonEmpty(target.nativeMessageId, 'target.nativeMessageId'),
    ...(target.clientMessageId?.trim() ? { clientMessageId: target.clientMessageId.trim() } : {}),
    ...(target.channel?.trim() ? { channel: target.channel.trim() } : {}),
    ...(target.accountId?.trim() ? { accountId: target.accountId.trim() } : {}),
    ...(target.target?.trim() ? { target: target.target.trim() } : {}),
    ...(target.threadId !== undefined && String(target.threadId).trim()
      ? { threadId: target.threadId }
      : {}),
  };
}

function assertPreviewIdentity(
  snapshot: CollaborationRunSnapshot,
  preview: CollaborationRunActionPreview,
): void {
  if (preview.runId !== snapshot.runId) {
    fail('PREVIEW_STALE', 'The confirmation preview belongs to another run');
  }
  requireSafeRevision(preview.runRevision, 'preview.runRevision');
  if (!preview.confirmationToken.trim() || !Number.isSafeInteger(preview.expiresAt)) {
    fail('INVALID_ACTION_INPUT', 'The server confirmation preview is invalid');
  }
  if (preview.expiresAt < Date.now()) {
    fail('PREVIEW_STALE', 'The server confirmation preview has expired');
  }
}

function uniqueLogicalIds(snapshot: CollaborationRunSnapshot, workItemIds: string[]): string[] {
  const unique = [...new Set(workItemIds.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) fail('INVALID_ACTION_INPUT', 'At least one work item must be selected');
  const known = new Set(snapshot.workItems.map((item) => item.logicalId));
  for (const id of unique) {
    if (!known.has(id)) fail('ENTITY_NOT_FOUND', `Work item ${id} is not present in the run snapshot`);
  }
  return unique;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

export async function buildRunAction(
  snapshot: CollaborationRunSnapshot,
  submission: CollaborationRunActionSubmission,
  expectedCollaborationInstanceId: string,
  commandId?: string,
): Promise<BuiltCollaborationRunAction> {
  assertAllowed(snapshot, submission.action);
  requireSafeRevision(snapshot.revision, 'run.revision');

  let payload: Record<string, unknown>;
  let revisions: {
    expectedCollaborationInstanceId: string;
    expectedRunRevision: number;
    currentPlanRevisionId?: string;
    expectedEntityRevision?: number;
  } = { expectedCollaborationInstanceId, expectedRunRevision: snapshot.revision };

  switch (submission.action) {
    case 'PLAN_REVISE': {
      payload = {
        runId: snapshot.runId,
        instruction: requireNonEmpty(submission.instruction, 'instruction'),
      };
      if (snapshot.currentPlanRevisionId) revisions.currentPlanRevisionId = snapshot.currentPlanRevisionId;
      break;
    }
    case 'PLAN_APPROVE': {
      const planRevisionId = snapshot.currentPlanRevisionId;
      if (!planRevisionId) fail('INVALID_ACTION_INPUT', 'The current plan revision is unavailable');
      payload = {
        runId: snapshot.runId,
        planRevisionId,
        assignments: validateAssignments(snapshot, submission.assignments),
      };
      revisions.currentPlanRevisionId = planRevisionId;
      break;
    }
    case 'CANCEL':
    case 'DISPATCH_STOP':
    case 'DISPATCH_RESUME':
    case 'RECONCILE':
    case 'ARCHIVE':
    case 'UNARCHIVE':
      payload = { runId: snapshot.runId };
      break;
    case 'WORK_ITEM_RETRY': {
      const item = requireWorkItem(snapshot, submission.workItemId);
      payload = { workItemId: item.id };
      revisions.expectedEntityRevision = requireSafeRevision(item.revision, 'workItem.revision');
      break;
    }
    case 'WORK_ITEM_INPUT_APPEND': {
      const item = requireWorkItem(snapshot, submission.workItemId);
      if (!workItemAcceptsAdditionalInput(snapshot, item)) {
        fail('INVALID_ACTION_INPUT', `Work item ${item.logicalId} cannot accept input before its next attempt`);
      }
      payload = {
        workItemId: item.id,
        content: requireNonEmpty(submission.content, 'content'),
      };
      revisions.expectedEntityRevision = requireSafeRevision(item.revision, 'workItem.revision');
      break;
    }
    case 'WORK_ITEM_CANCEL': {
      const item = requireWorkItem(snapshot, submission.workItemId);
      if (!submission.confirmed) {
        fail('CONFIRMATION_REQUIRED', 'Work-item cancellation requires confirmation');
      }
      if (!workItemCanBeCancelled(item)) {
        fail('INVALID_ACTION_INPUT', `Work item ${item.logicalId} cannot be cancelled from ${item.status}`);
      }
      payload = { workItemId: item.id };
      revisions.expectedEntityRevision = requireSafeRevision(item.revision, 'workItem.revision');
      break;
    }
    case 'WORK_ITEM_REASSIGN': {
      const item = requireWorkItem(snapshot, submission.workItemId);
      const agentId = requireNonEmpty(submission.agentId, 'agentId');
      const candidates = candidateAgentIdsForWorkItem(snapshot, item);
      if (candidates.length === 0 || !candidates.includes(agentId)) {
        fail('INVALID_ACTION_INPUT', `${agentId} is not an approved candidate for ${item.logicalId}`);
      }
      payload = { workItemId: item.id, agentId };
      revisions.expectedEntityRevision = requireSafeRevision(item.revision, 'workItem.revision');
      break;
    }
    case 'ATTEMPT_RESOLVE_UNKNOWN': {
      const attempt = requireUnknownAttempt(snapshot, submission.attemptId);
      if (!resolutionsForUnknownAttempt(snapshot, attempt).includes(submission.resolution)) {
        fail('INVALID_ACTION_INPUT', `Unsupported unknown-attempt resolution ${String(submission.resolution)}`);
      }
      if (submission.resolution === 'ABANDONED' && submission.acceptResidualRisk !== true) {
        fail('CONFIRMATION_REQUIRED', 'Abandoning an unknown attempt requires residual-risk confirmation');
      }
      payload = {
        attemptId: attempt.id,
        resolution: submission.resolution,
        acceptResidualRisk: submission.resolution === 'ABANDONED',
      };
      revisions.expectedEntityRevision = requireSafeRevision(attempt.revision, 'attempt.revision');
      break;
    }
    case 'PARTIAL': {
      const workItemIds = uniqueLogicalIds(snapshot, submission.workItemIds);
      if (!submission.preview) fail('PREVIEW_REQUIRED', 'A server partial-closure preview is required');
      const preview = decodeActionRead(
        'junqi.collab.run.partial.preview',
        submission.preview,
        { runId: snapshot.runId, workItemIds },
      );
      assertPreviewIdentity(snapshot, preview);
      if (preview.runRevision !== snapshot.revision) {
        fail('PREVIEW_STALE', 'The run changed after the partial-closure preview');
      }
      if (!sameStringSet(workItemIds, preview.closure.waiveIds)) {
        fail('PREVIEW_STALE', 'The selected work items do not match the server preview');
      }
      payload = {
        runId: snapshot.runId,
        workItemIds,
        expiresAt: preview.expiresAt,
        confirmationToken: preview.confirmationToken,
      };
      revisions = { expectedCollaborationInstanceId, expectedRunRevision: preview.runRevision };
      break;
    }
    case 'DELIVERY_RETRY': {
      const delivery = requireDelivery(snapshot, submission.deliveryId);
      if (!deliveryCanRetry(snapshot, delivery)) {
        fail('INVALID_ACTION_INPUT', `Delivery ${delivery.id} cannot be retried from ${delivery.status}`);
      }
      payload = { deliveryId: delivery.id };
      revisions.expectedEntityRevision = requireSafeRevision(delivery.revision, 'delivery.revision');
      break;
    }
    case 'DELIVERY_RETARGET': {
      const delivery = requireDelivery(snapshot, submission.deliveryId);
      if (!deliveryCanRetargetOrAbandon(snapshot, delivery)) {
        fail('INVALID_ACTION_INPUT', `Delivery ${delivery.id} cannot be retargeted from ${delivery.status}`);
      }
      if (deliveryTargetsSameSession(delivery, submission.target)) {
        fail('INVALID_ACTION_INPUT', 'The replacement target must be a different OpenClaw session');
      }
      payload = { deliveryId: delivery.id, target: validateOrigin(submission.target) };
      revisions.expectedEntityRevision = requireSafeRevision(delivery.revision, 'delivery.revision');
      break;
    }
    case 'DELIVERY_ABANDON': {
      const delivery = requireDelivery(snapshot, submission.deliveryId);
      if (!deliveryCanRetargetOrAbandon(snapshot, delivery)) {
        fail('INVALID_ACTION_INPUT', `Delivery ${delivery.id} cannot be abandoned from ${delivery.status}`);
      }
      if (!submission.confirmed) fail('CONFIRMATION_REQUIRED', 'Delivery abandonment requires confirmation');
      payload = { deliveryId: delivery.id, confirm: true };
      revisions.expectedEntityRevision = requireSafeRevision(delivery.revision, 'delivery.revision');
      break;
    }
    case 'EXPORT':
      payload = { runId: snapshot.runId, format: 'json' };
      break;
    case 'CLONE':
      payload = {
        runId: snapshot.runId,
        ...(submission.goal?.trim() ? { goal: submission.goal.trim() } : {}),
      };
      break;
    case 'DELETE': {
      if (!submission.confirmed) fail('CONFIRMATION_REQUIRED', 'Run deletion requires confirmation');
      if (!submission.preview) fail('PREVIEW_REQUIRED', 'A server deletion preview is required');
      const preview = decodeActionRead(
        'junqi.collab.run.delete.preview',
        submission.preview,
        { runId: snapshot.runId },
      );
      assertPreviewIdentity(snapshot, preview);
      if (preview.runRevision !== snapshot.revision) {
        fail('PREVIEW_STALE', 'The run changed after the deletion preview');
      }
      const blocker = preview.flowReconciliationBlocker;
      if (blocker) {
        if (submission.abandonFlowReconciliation !== true) {
          fail(
            'CONFIRMATION_REQUIRED',
            'Run deletion requires explicit Flow reconciliation abandonment confirmation',
          );
        }
        if (typeof submission.abandonmentReason !== 'string' || !submission.abandonmentReason.trim()) {
          fail('INVALID_ACTION_INPUT', 'abandonmentReason is required');
        }
      } else if (
        submission.abandonFlowReconciliation !== undefined
        || submission.abandonmentReason !== undefined
      ) {
        fail(
          'INVALID_ACTION_INPUT',
          'Flow reconciliation abandonment is only valid when the server preview reports a blocker',
        );
      }
      payload = {
        runId: snapshot.runId,
        expiresAt: preview.expiresAt,
        confirmationToken: preview.confirmationToken,
        ...(blocker
          ? {
              abandonFlowReconciliation: submission.abandonFlowReconciliation,
              abandonmentReason: submission.abandonmentReason,
            }
          : {}),
      };
      revisions = { expectedCollaborationInstanceId, expectedRunRevision: preview.runRevision };
      break;
    }
  }

  return {
    action: submission.action,
    method: ACTION_METHODS[submission.action],
    request: await createCollaborationWriteRequest(payload, revisions, commandId),
  };
}

export async function previewRunAction(
  snapshot: CollaborationRunSnapshot,
  submission: Extract<CollaborationRunActionSubmission, { action: 'PARTIAL' | 'DELETE' }>,
  callRpc?: CollaborationActionReadCall,
): Promise<CollaborationRunActionPreview> {
  assertAllowed(snapshot, submission.action);
  if (submission.action === 'PARTIAL') {
    const workItemIds = uniqueLogicalIds(snapshot, submission.workItemIds);
    const params = { runId: snapshot.runId, workItemIds };
    const preview = await readActionContract(
      'junqi.collab.run.partial.preview',
      params,
      callRpc,
      (readParams) => collaborationClient.previewPartialRun(readParams),
    );
    assertPreviewIdentity(snapshot, preview);
    if (preview.runRevision !== snapshot.revision) {
      fail('PREVIEW_STALE', 'The run changed while the partial-closure preview was requested');
    }
    if (!sameStringSet(preview.closure.waiveIds, workItemIds)) {
      fail('PREVIEW_STALE', 'The server preview does not match the selected work items');
    }
    return preview;
  }

  const params = { runId: snapshot.runId };
  const preview = await readActionContract(
    'junqi.collab.run.delete.preview',
    params,
    callRpc,
    (readParams) => collaborationClient.previewRunDeletion(readParams),
  );
  assertPreviewIdentity(snapshot, preview);
  if (preview.runRevision !== snapshot.revision) {
    fail('PREVIEW_STALE', 'The run changed while the deletion preview was requested');
  }
  return preview;
}

export async function executeRunAction(
  snapshot: CollaborationRunSnapshot,
  submission: CollaborationRunActionSubmission,
  options: {
    expectedCollaborationInstanceId: string;
    client?: CollaborationActionWriteClient;
    commandId?: string;
  },
): Promise<CollaborationWriteResponse> {
  const built = await buildRunAction(
    snapshot,
    submission,
    options.expectedCollaborationInstanceId,
    options.commandId,
  );
  return (options.client ?? collaborationClient).write(built.method, built.request);
}

export interface CompletedCollaborationExport {
  jobId: string;
  digest: string;
  filename: string;
  content: string;
}

export interface CollaborationDeletionStatusCall {
  (method: 'junqi.collab.run.delete.get', params: Record<string, unknown>): Promise<unknown>;
}

export interface CompletedCollaborationDeletion {
  jobId: string;
  status: Extract<CollaborationDeletionJobStatus, 'COMPLETED' | 'PARTIAL' | 'FAILED'>;
  lastError: string | null;
}

function requireJobReceipt(
  response: CollaborationWriteResponse,
  expectedRunIdInput: string,
  jobIdField: 'deletionJobId' | 'exportJobId',
  operation: string,
): { runId: string; jobId: string } {
  const runId = requireNonEmpty(expectedRunIdInput, 'runId');
  const receiptRunId = typeof response.runId === 'string' ? response.runId.trim() : '';
  if (receiptRunId !== runId) {
    fail('INVALID_ACTION_RESPONSE', `${operation} receipt does not belong to run ${runId}`);
  }
  const rawJobId = response[jobIdField];
  const jobId = typeof rawJobId === 'string' ? rawJobId.trim() : '';
  if (!jobId) fail('INVALID_ACTION_RESPONSE', `${operation} receipt is missing ${jobIdField}`);
  return { runId, jobId };
}

async function sha256Utf8(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    fail('INVALID_ACTION_RESPONSE', 'Web Crypto is required to verify an export artifact');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let index = 0; index < 64; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/** Wait for a deletion job to reach a durable terminal state without reading deleted content. */
export async function completeCollaborationDeletion(
  response: CollaborationWriteResponse,
  runIdInput: string,
  options: {
    callRpc?: CollaborationDeletionStatusCall;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<CompletedCollaborationDeletion> {
  const { runId, jobId } = requireJobReceipt(
    response,
    runIdInput,
    'deletionJobId',
    'run.delete',
  );
  const params = { jobId, expectedRunId: runId };
  const rawRead = options.callRpc
    ? ((method: 'junqi.collab.run.delete.get', readParams: typeof params) => (
        options.callRpc!(method, readParams)
      ))
    : undefined;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + Math.max(1_000, options.timeoutMs ?? 30_000);
  const pollMs = Math.max(25, options.pollMs ?? 250);

  while (true) {
    const job = await readActionContract(
      'junqi.collab.run.delete.get',
      params,
      rawRead,
      (readParams) => collaborationClient.getRunDeletionJob(readParams),
    );
    if (job.id !== jobId || job.runId !== runId) {
      fail('INVALID_ACTION_RESPONSE', 'Deletion job identity changed after contract decoding');
    }
    const status = job.status;
    const lastError = job.lastError;
    if (status === 'COMPLETED' || status === 'PARTIAL' || status === 'FAILED') {
      return { jobId, status, lastError };
    }
    if (status !== 'PENDING') {
      fail('INVALID_ACTION_INPUT', `Deletion job returned unsupported status ${status || '<empty>'}`);
    }
    if (now() >= deadline) fail('INVALID_ACTION_INPUT', `Deletion job ${jobId} timed out`);
    await sleep(pollMs);
  }
}

function downloadJson(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Wait for the durable export job, then materialize the server-authored artifact for the user. */
export async function completeCollaborationExport(
  response: CollaborationWriteResponse,
  runId: string,
  options: {
    callRpc?: CollaborationExportCall;
    download?: (content: string, filename: string) => void;
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    pollMs?: number;
  } = {},
): Promise<CompletedCollaborationExport> {
  const { runId: boundRunId, jobId } = requireJobReceipt(
    response,
    runId,
    'exportJobId',
    'export.create',
  );
  const statusParams = { jobId, expectedRunId: boundRunId };
  const rawStatusRead = options.callRpc
    ? ((method: 'junqi.collab.export.get', readParams: typeof statusParams) => (
        options.callRpc!(method, readParams)
      ))
    : undefined;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + Math.max(1_000, options.timeoutMs ?? 30_000);
  const pollMs = Math.max(25, options.pollMs ?? 250);

  let completedDigest: string | null = null;
  while (completedDigest === null) {
    const job = await readActionContract(
      'junqi.collab.export.get',
      statusParams,
      rawStatusRead,
      (readParams) => collaborationClient.getExportJob(readParams),
    );
    if (job.id !== jobId || job.runId !== boundRunId) {
      fail('INVALID_ACTION_RESPONSE', 'Export job identity changed after contract decoding');
    }
    const status = job.status;
    if (status === 'COMPLETED') {
      if (job.digest === null) {
        fail('INVALID_ACTION_RESPONSE', 'Completed export job is missing its digest');
      }
      completedDigest = job.digest;
      break;
    }
    if (status === 'FAILED') {
      const reason = job.lastError ?? 'Export job failed';
      fail('INVALID_ACTION_INPUT', reason);
    }
    if (now() >= deadline) fail('INVALID_ACTION_INPUT', 'Export job timed out');
    await sleep(pollMs);
  }

  const artifactParams = { jobId, expectedDigest: completedDigest };
  const rawArtifactRead = options.callRpc
    ? ((method: 'junqi.collab.export.download', readParams: typeof artifactParams) => (
        options.callRpc!(method, readParams)
      ))
    : undefined;
  const artifact = await readActionContract(
    'junqi.collab.export.download',
    artifactParams,
    rawArtifactRead,
    (readParams) => collaborationClient.downloadExport(readParams),
  );
  if (artifact.jobId !== jobId || artifact.digest !== completedDigest) {
    fail('INVALID_ACTION_RESPONSE', 'Export artifact identity changed after contract decoding');
  }
  const content = artifact.content;
  const digest = artifact.digest;
  const actualDigest = await sha256Utf8(content);
  if (!constantTimeHexEqual(actualDigest, completedDigest)) {
    fail('INVALID_ACTION_RESPONSE', 'Export artifact content does not match its completed job digest');
  }
  const safeRunId = boundRunId.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const filename = `junqi-collaboration-${safeRunId}.json`;
  (options.download ?? downloadJson)(content, filename);
  return { jobId, digest, filename, content };
}
