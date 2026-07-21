import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle, Check, Loader2, ShieldAlert, X } from 'lucide-react';
import { useModalFocusScope } from '@/hooks/useModalFocusScope';
import { cn } from '@/lib/utils';
import {
  deleteConfirmationReady,
  resolutionsForUnknownAttempt,
  candidateAgentIdsForWorkItem,
  deliveryCanRetargetOrAbandon,
  deliveryCanRetry,
  deliveryTargetsSameSession,
  isCollaborationRunAction,
  isRunActionAllowed,
  workItemAcceptsAdditionalInput,
  workItemCanBeCancelled,
  type CollaborationDeletePreview,
  type CollaborationPartialPreview,
  type CollaborationRunAction,
  type CollaborationRunActionPreview,
  type CollaborationRunActionSubmission,
  type CollaborationAttemptUnknownResolution,
} from '@/services/collaboration/runActions';
import type {
  CollaborationAttemptSnapshot,
  CollaborationDeliverySnapshot,
  CollaborationOriginRef,
  CollaborationRunSnapshot,
  CollaborationWorkItemSnapshot,
} from '@/services/collaboration/types';
import { useCollaborationText, type CollaborationTranslate } from './CollaborationCard';
import { CollaborationAttemptIdentity } from './CollaborationAttemptIdentity';

export interface CollaborationActionDialogProps {
  open: boolean;
  action: string | null;
  snapshot: CollaborationRunSnapshot;
  preview?: CollaborationRunActionPreview | null;
  submitting?: boolean;
  previewing?: boolean;
  error?: string | null;
  initialEntityId?: string;
  initialWorkItemIds?: readonly string[];
  initialAssignments?: Record<string, string>;
  translate?: CollaborationTranslate;
  onClose: () => void;
  onSubmit: (submission: CollaborationRunActionSubmission) => void | Promise<void>;
  className?: string;
}

type OriginField = keyof Pick<
  CollaborationOriginRef,
  | 'runtimeId'
  | 'agentId'
  | 'sessionKey'
  | 'sessionId'
  | 'nativeMessageId'
  | 'clientMessageId'
  | 'channel'
  | 'accountId'
  | 'target'
> | 'threadId';

type OriginDraft = Record<OriginField, string>;

const EMPTY_ORIGIN: OriginDraft = {
  runtimeId: '',
  agentId: '',
  sessionKey: '',
  sessionId: '',
  nativeMessageId: '',
  clientMessageId: '',
  channel: '',
  accountId: '',
  target: '',
  threadId: '',
};

const EMPTY_WORK_ITEM_IDS: readonly string[] = [];
const EMPTY_ASSIGNMENTS: Record<string, string> = {};

const ACTION_FALLBACKS: Record<CollaborationRunAction, string> = {
  PLAN_REVISE: 'Revise plan',
  PLAN_APPROVE: 'Approve plan',
  CANCEL: 'Cancel run',
  DISPATCH_STOP: 'Stop dispatch',
  DISPATCH_RESUME: 'Resume dispatch',
  WORK_ITEM_INPUT_APPEND: 'Add input',
  WORK_ITEM_CANCEL: 'Cancel work item',
  WORK_ITEM_RETRY: 'Retry work item',
  WORK_ITEM_REASSIGN: 'Reassign work item',
  ATTEMPT_RESOLVE_UNKNOWN: 'Resolve unknown attempt',
  PARTIAL: 'Accept partial result',
  RECONCILE: 'Reconcile run',
  DELIVERY_RETRY: 'Retry delivery',
  DELIVERY_RETARGET: 'Change delivery target',
  DELIVERY_ABANDON: 'Abandon delivery',
  EXPORT: 'Export run',
  CLONE: 'Clone run',
  ARCHIVE: 'Archive run',
  UNARCHIVE: 'Unarchive run',
  DELETE: 'Delete run',
};

const REQUIRED_ORIGIN_FIELDS: OriginField[] = [
  'runtimeId',
  'agentId',
  'sessionKey',
  'sessionId',
  'nativeMessageId',
];

const OPTIONAL_ORIGIN_FIELDS: OriginField[] = [
  'clientMessageId',
  'channel',
  'accountId',
  'target',
  'threadId',
];

function originDraft(target: CollaborationOriginRef | undefined): OriginDraft {
  const draft = { ...EMPTY_ORIGIN };
  if (!target) return draft;
  for (const key of [...REQUIRED_ORIGIN_FIELDS, ...OPTIONAL_ORIGIN_FIELDS]) {
    const value = target[key];
    if (typeof value === 'string' || typeof value === 'number') draft[key] = String(value);
  }
  return draft;
}

function actionLabel(action: CollaborationRunAction, text: CollaborationTranslate): string {
  return text(`collaboration.actions.${action}`, ACTION_FALLBACKS[action]);
}

function workItemLabel(item: CollaborationWorkItemSnapshot): string {
  return `${item.title || item.logicalId} (rev ${item.revision})`;
}

function deliveryLabel(delivery: CollaborationDeliverySnapshot): string {
  return `${delivery.status} / target ${delivery.targetRevision} (rev ${delivery.revision})`;
}

function attemptLabel(attempt: CollaborationAttemptSnapshot): string {
  return `${attempt.kind} #${attempt.attemptNo} / ${attempt.workerAgentId} (rev ${attempt.revision})`;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

function isPartialPreview(value: CollaborationRunActionPreview | null | undefined): value is CollaborationPartialPreview {
  return Boolean(value && 'closure' in value);
}

function isDeletePreview(value: CollaborationRunActionPreview | null | undefined): value is CollaborationDeletePreview {
  return Boolean(value && 'digest' in value);
}

function FieldLabel({ children, optional = false }: { children: string; optional?: boolean }) {
  return (
    <span className="mb-1.5 flex items-center justify-between gap-2 text-[10.5px] font-medium text-aegis-text-muted">
      <span>{children}</span>
      {optional && <span className="font-normal text-aegis-text-dim">optional</span>}
    </span>
  );
}

const inputClassName = cn(
  'h-9 w-full min-w-0 rounded-md border border-aegis-border bg-aegis-input px-2.5 text-[11.5px] text-aegis-text outline-none',
  'focus:border-aegis-primary/55 disabled:cursor-not-allowed disabled:opacity-50',
);

export function CollaborationActionDialog({
  open,
  action: actionValue,
  snapshot,
  preview,
  submitting = false,
  previewing = false,
  error,
  initialEntityId,
  initialWorkItemIds = EMPTY_WORK_ITEM_IDS,
  initialAssignments = EMPTY_ASSIGNMENTS,
  translate,
  onClose,
  onSubmit,
  className,
}: CollaborationActionDialogProps) {
  const text = useCollaborationText(translate);
  const action = actionValue && isCollaborationRunAction(actionValue) ? actionValue : null;
  const previewConfirmationToken = preview?.confirmationToken ?? null;
  const initialDelivery = snapshot.deliveries.find((delivery) => delivery.id === initialEntityId);
  const initialUnknownAttempt = snapshot.attempts.find((attempt) => attempt.status === 'UNKNOWN');
  const [instruction, setInstruction] = useState('');
  const [assignments, setAssignments] = useState<Record<string, string>>({ ...initialAssignments });
  const [selectedEntityId, setSelectedEntityId] = useState(
    initialEntityId ?? (action === 'ATTEMPT_RESOLVE_UNKNOWN' ? initialUnknownAttempt?.id ?? '' : ''),
  );
  const [additionalInput, setAdditionalInput] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedLogicalIds, setSelectedLogicalIds] = useState<string[]>([...initialWorkItemIds]);
  const [confirmed, setConfirmed] = useState(false);
  const [flowAbandonmentConfirmed, setFlowAbandonmentConfirmed] = useState(false);
  const [abandonmentReason, setAbandonmentReason] = useState('');
  const [attemptResolution, setAttemptResolution] = useState<CollaborationAttemptUnknownResolution | ''>('');
  const [cloneGoal, setCloneGoal] = useState('');
  const [target, setTarget] = useState<OriginDraft>(() => originDraft(initialDelivery?.target));
  const busy = submitting || previewing;

  useEffect(() => {
    if (!open) return;
    setInstruction('');
    setAssignments({ ...initialAssignments });
    setSelectedEntityId(initialEntityId ?? (action === 'ATTEMPT_RESOLVE_UNKNOWN' ? initialUnknownAttempt?.id ?? '' : ''));
    setAdditionalInput('');
    setSelectedAgentId('');
    setSelectedLogicalIds([...initialWorkItemIds]);
    setConfirmed(false);
    setFlowAbandonmentConfirmed(false);
    setAbandonmentReason('');
    setAttemptResolution('');
    setCloneGoal('');
    const delivery = snapshot.deliveries.find((candidate) => candidate.id === initialEntityId);
    setTarget(originDraft(delivery?.target));
  }, [action, initialEntityId, open, previewConfirmationToken, snapshot.runId, snapshot.revision]);

  const retryableItems = useMemo(
    () => snapshot.workItems.filter((item) => item.status === 'NEEDS_INTERVENTION' || item.status === 'CANCELLED'),
    [snapshot.workItems],
  );
  const inputEligibleItems = useMemo(
    () => snapshot.workItems.filter((item) => workItemAcceptsAdditionalInput(snapshot, item)),
    [snapshot.attempts, snapshot.workItems],
  );
  const cancelableItems = useMemo(
    () => snapshot.workItems.filter(workItemCanBeCancelled),
    [snapshot.workItems],
  );
  const reassignableItems = useMemo(
    () => snapshot.workItems.filter((item) => (
      (item.status === 'NEEDS_INTERVENTION' || item.status === 'CANCELLED')
      && !snapshot.attempts.some((attempt) => (
        attempt.workItemId === item.id
        && ['CREATED', 'DISPATCHING', 'RUNNING', 'CANCELLING', 'UNKNOWN'].includes(attempt.status)
      ))
    )),
    [snapshot.attempts, snapshot.workItems],
  );
  const partialItems = useMemo(
    () => snapshot.workItems.filter((item) => item.status !== 'SUCCEEDED' && item.status !== 'WAIVED'),
    [snapshot.workItems],
  );
  const unknownAttempts = useMemo(
    () => snapshot.attempts.filter((attempt) => attempt.status === 'UNKNOWN'),
    [snapshot.attempts],
  );
  const selectableWorkItems = action === 'WORK_ITEM_INPUT_APPEND'
    ? inputEligibleItems
    : action === 'WORK_ITEM_CANCEL'
      ? cancelableItems
      : action === 'WORK_ITEM_RETRY'
        ? retryableItems
        : action === 'WORK_ITEM_REASSIGN'
          ? reassignableItems
          : [];
  const selectedWorkItem = selectableWorkItems.find((item) => item.id === selectedEntityId);
  const selectedUnknownAttempt = unknownAttempts.find((attempt) => attempt.id === selectedEntityId);
  const availableAttemptResolutions = resolutionsForUnknownAttempt(snapshot, selectedUnknownAttempt);
  const eligibleDeliveries = action === 'DELIVERY_RETRY'
    ? snapshot.deliveries.filter((delivery) => deliveryCanRetry(snapshot, delivery))
    : action === 'DELIVERY_RETARGET' || action === 'DELIVERY_ABANDON'
      ? snapshot.deliveries.filter((delivery) => deliveryCanRetargetOrAbandon(snapshot, delivery))
      : snapshot.deliveries;
  const selectedDelivery = eligibleDeliveries.find((delivery) => delivery.id === selectedEntityId);
  const candidateAgentIds = selectedWorkItem
    ? candidateAgentIdsForWorkItem(snapshot, selectedWorkItem)
    : [];
  const matchingPartialPreview = isPartialPreview(preview)
    && preview.runId === snapshot.runId
    && preview.runRevision === snapshot.revision
    && sameIds(preview.closure.waiveIds, selectedLogicalIds)
    ? preview
    : undefined;
  const matchingDeletePreview = isDeletePreview(preview)
    && preview.runId === snapshot.runId
    && preview.runRevision === snapshot.revision
    ? preview
    : undefined;
  const flowReconciliationBlocker = matchingDeletePreview?.flowReconciliationBlocker;
  const flowAbandonmentReady = !flowReconciliationBlocker || (
    flowAbandonmentConfirmed && Boolean(abandonmentReason.trim())
  );
  const dialogRenderable = Boolean(
    open
    && action
    && isRunActionAllowed(snapshot, action)
    && (action !== 'ATTEMPT_RESOLVE_UNKNOWN' || unknownAttempts.length > 0)
  );
  const dialogRef = useModalFocusScope<HTMLElement>({
    active: dialogRenderable,
    onEscape: onClose,
    escapeDisabled: busy,
    initialFocus: 'autofocus-or-container',
    layer: 30,
  });

  if (!dialogRenderable || !action) return null;

  const planAssignmentsValid = snapshot.workItems.length > 0 && snapshot.workItems.every((item) => {
    const assigned = assignments[item.logicalId];
    return Boolean(assigned && candidateAgentIdsForWorkItem(snapshot, item).includes(assigned));
  });
  const targetValid = REQUIRED_ORIGIN_FIELDS.every((field) => target[field].trim());

  let valid = true;
  switch (action) {
    case 'PLAN_REVISE':
      valid = Boolean(instruction.trim());
      break;
    case 'PLAN_APPROVE':
      valid = Boolean(snapshot.currentPlanRevisionId && planAssignmentsValid);
      break;
    case 'WORK_ITEM_RETRY':
      valid = retryableItems.some((item) => item.id === selectedEntityId);
      break;
    case 'WORK_ITEM_INPUT_APPEND':
      valid = Boolean(
        additionalInput.trim()
        && inputEligibleItems.some((item) => item.id === selectedEntityId),
      );
      break;
    case 'WORK_ITEM_CANCEL':
      valid = confirmed && cancelableItems.some((item) => item.id === selectedEntityId);
      break;
    case 'WORK_ITEM_REASSIGN':
      valid = Boolean(
        reassignableItems.some((item) => item.id === selectedEntityId)
        && selectedWorkItem
        && candidateAgentIds.includes(selectedAgentId),
      );
      break;
    case 'ATTEMPT_RESOLVE_UNKNOWN':
      valid = Boolean(
        selectedUnknownAttempt
        && attemptResolution
        && availableAttemptResolutions.includes(attemptResolution)
        && (attemptResolution !== 'ABANDONED' || confirmed),
      );
      break;
    case 'PARTIAL':
      valid = selectedLogicalIds.length > 0 && (!matchingPartialPreview || confirmed);
      break;
    case 'DELIVERY_RETRY':
      valid = Boolean(selectedDelivery);
      break;
    case 'DELIVERY_RETARGET':
      valid = Boolean(
        selectedDelivery
        && targetValid
        && !deliveryTargetsSameSession(selectedDelivery, target as CollaborationOriginRef),
      );
      break;
    case 'DELIVERY_ABANDON':
      valid = Boolean(selectedDelivery && confirmed);
      break;
    case 'DELETE':
      valid = !matchingDeletePreview || deleteConfirmationReady(matchingDeletePreview, {
        confirmed,
        abandonFlowReconciliation: flowAbandonmentConfirmed,
        abandonmentReason,
      });
      break;
  }

  const selectDelivery = (deliveryId: string) => {
    setSelectedEntityId(deliveryId);
    setConfirmed(false);
    const delivery = snapshot.deliveries.find((candidate) => candidate.id === deliveryId);
    setTarget(originDraft(delivery?.target));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid || busy) return;
    let submission: CollaborationRunActionSubmission;
    switch (action) {
      case 'PLAN_REVISE':
        submission = { action, instruction: instruction.trim() };
        break;
      case 'PLAN_APPROVE':
        submission = { action, assignments };
        break;
      case 'WORK_ITEM_RETRY':
        submission = { action, workItemId: selectedEntityId };
        break;
      case 'WORK_ITEM_INPUT_APPEND':
        submission = { action, workItemId: selectedEntityId, content: additionalInput.trim() };
        break;
      case 'WORK_ITEM_CANCEL':
        submission = { action, workItemId: selectedEntityId, confirmed: true };
        break;
      case 'WORK_ITEM_REASSIGN':
        submission = { action, workItemId: selectedEntityId, agentId: selectedAgentId };
        break;
      case 'ATTEMPT_RESOLVE_UNKNOWN':
        if (!attemptResolution) return;
        submission = {
          action,
          attemptId: selectedEntityId,
          resolution: attemptResolution,
          ...(attemptResolution === 'ABANDONED' ? { acceptResidualRisk: confirmed } : {}),
        };
        break;
      case 'PARTIAL':
        submission = { action, workItemIds: selectedLogicalIds, ...(matchingPartialPreview ? { preview: matchingPartialPreview } : {}) };
        break;
      case 'DELIVERY_RETRY':
        submission = { action, deliveryId: selectedEntityId };
        break;
      case 'DELIVERY_RETARGET': {
        const retarget: CollaborationOriginRef = {
          runtimeId: target.runtimeId.trim(),
          agentId: target.agentId.trim(),
          sessionKey: target.sessionKey.trim(),
          sessionId: target.sessionId.trim(),
          nativeMessageId: target.nativeMessageId.trim(),
          ...(target.clientMessageId.trim() ? { clientMessageId: target.clientMessageId.trim() } : {}),
          ...(target.channel.trim() ? { channel: target.channel.trim() } : {}),
          ...(target.accountId.trim() ? { accountId: target.accountId.trim() } : {}),
          ...(target.target.trim() ? { target: target.target.trim() } : {}),
          ...(target.threadId.trim() ? { threadId: target.threadId.trim() } : {}),
        };
        submission = { action, deliveryId: selectedEntityId, target: retarget };
        break;
      }
      case 'DELIVERY_ABANDON':
        submission = { action, deliveryId: selectedEntityId, confirmed: true };
        break;
      case 'CLONE':
        submission = { action, ...(cloneGoal.trim() ? { goal: cloneGoal.trim() } : {}) };
        break;
      case 'DELETE':
        submission = {
          action,
          confirmed: Boolean(matchingDeletePreview && confirmed),
          ...(matchingDeletePreview ? { preview: matchingDeletePreview } : {}),
          ...(flowReconciliationBlocker
            ? {
                abandonFlowReconciliation: flowAbandonmentConfirmed,
                abandonmentReason,
              }
            : {}),
        };
        break;
      default:
        submission = { action } as CollaborationRunActionSubmission;
    }
    void onSubmit(submission);
  };

  const buttonLabel = action === 'PARTIAL' && !matchingPartialPreview
    ? text('collaboration.actionDialog.preview', 'Preview impact')
    : action === 'DELETE' && !matchingDeletePreview
      ? text('collaboration.actionDialog.previewDelete', 'Preview deletion')
      : actionLabel(action, text);

  return (
    <div
      className="fixed inset-0 z-[2147481000] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collaboration-action-dialog-title"
        tabIndex={-1}
        className={cn(
          'flex max-h-[min(760px,90vh)] w-full max-w-[560px] min-w-0 flex-col overflow-hidden rounded-lg border border-aegis-border bg-aegis-bg-solid text-aegis-text shadow-float outline-none',
          className,
        )}
      >
        <header className="flex min-w-0 items-start justify-between gap-3 border-b border-aegis-border px-4 py-3.5">
          <div className="min-w-0">
            <h2 id="collaboration-action-dialog-title" className="truncate text-[14px] font-semibold text-aegis-text">
              {actionLabel(action, text)}
            </h2>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-aegis-text-dim">
              <span className="truncate font-mono">{snapshot.runId}</span>
              <span aria-hidden>/</span>
              <span className="font-mono tabular-nums">{text('collaboration.details.revisionValue', 'Revision {{revision}}', { revision: snapshot.revision })}</span>
              {snapshot.currentPlanRevisionId && (action === 'PLAN_REVISE' || action === 'PLAN_APPROVE') && (
                <><span aria-hidden>/</span><span className="truncate font-mono">{snapshot.currentPlanRevisionId}</span></>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            title={text('collaboration.common.close', 'Close')}
            aria-label={text('collaboration.common.close', 'Close')}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-45"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {action === 'PLAN_REVISE' && (
              <label className="block">
                <FieldLabel>{text('collaboration.actionDialog.revisionInstruction', 'Revision instruction')}</FieldLabel>
                <textarea
                  value={instruction}
                  onChange={(event) => setInstruction(event.target.value)}
                  rows={5}
                  data-modal-initial-focus
                  placeholder={text('collaboration.actionDialog.revisionInstructionHint', 'Describe what the planner must change.')}
                  className="w-full resize-y rounded-md border border-aegis-border bg-aegis-input px-2.5 py-2 text-[11.5px] leading-5 text-aegis-text outline-none focus:border-aegis-primary/55"
                />
              </label>
            )}

            {action === 'PLAN_APPROVE' && (
              <div className="space-y-3">
                <p className="text-[11px] leading-4 text-aegis-text-muted">
                  {text('collaboration.actionDialog.assignEveryItem', 'Choose an approved agent for every work item before starting.')}
                </p>
                {snapshot.workItems.map((item) => {
                  const candidates = candidateAgentIdsForWorkItem(snapshot, item);
                  return (
                    <label key={item.id} className="block">
                      <FieldLabel>{workItemLabel(item)}</FieldLabel>
                      <select
                        value={assignments[item.logicalId] ?? ''}
                        onChange={(event) => setAssignments((current) => ({ ...current, [item.logicalId]: event.target.value }))}
                        className={inputClassName}
                      >
                        <option value="">{text('collaboration.actionDialog.chooseAgent', 'Choose an agent')}</option>
                        {candidates.map((agentId) => <option key={agentId} value={agentId}>{agentId}</option>)}
                      </select>
                      {candidates.length === 0 && (
                        <span role="alert" className="mt-1.5 block text-[10px] text-aegis-danger">
                          {text('collaboration.actionDialog.candidatesUnavailable', 'Approved agent candidates are unavailable. Refresh the run snapshot.')}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {(
              action === 'WORK_ITEM_INPUT_APPEND'
              || action === 'WORK_ITEM_CANCEL'
              || action === 'WORK_ITEM_RETRY'
              || action === 'WORK_ITEM_REASSIGN'
            ) && (
              <div className="space-y-3">
                <label className="block">
                  <FieldLabel>{text('collaboration.actionDialog.workItem', 'Work item')}</FieldLabel>
                  <select
                    value={selectedEntityId}
                    onChange={(event) => {
                      setSelectedEntityId(event.target.value);
                      setSelectedAgentId('');
                      setConfirmed(false);
                    }}
                    className={inputClassName}
                  >
                    <option value="">{text('collaboration.actionDialog.chooseWorkItem', 'Choose a work item')}</option>
                    {selectableWorkItems.map((item) => (
                      <option key={item.id} value={item.id}>{workItemLabel(item)}</option>
                    ))}
                  </select>
                </label>
                {selectableWorkItems.length === 0 && (
                  <div role="status" className="rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2.5 text-[10.5px] leading-4 text-aegis-text-muted">
                    {action === 'WORK_ITEM_INPUT_APPEND'
                      ? text('collaboration.actionDialog.noInputEligibleItem', 'No work item can accept input now. Active attempts must settle or be cancelled first.')
                      : text('collaboration.actionDialog.noEligibleWorkItem', 'No work item is eligible for this action.')}
                  </div>
                )}
                {selectedWorkItem && (
                  <div className="rounded-md bg-[rgb(var(--aegis-overlay)/0.035)] px-2.5 py-2 text-[10px] text-aegis-text-muted">
                    {text('collaboration.actionDialog.entityRevision', 'Entity revision')}: <span className="font-mono">{selectedWorkItem.revision}</span>
                  </div>
                )}
                {action === 'WORK_ITEM_REASSIGN' && selectedWorkItem && (
                  <label className="block">
                    <FieldLabel>{text('collaboration.actionDialog.newAgent', 'New agent')}</FieldLabel>
                    <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} className={inputClassName}>
                      <option value="">{text('collaboration.actionDialog.chooseAgent', 'Choose an agent')}</option>
                      {candidateAgentIds.map((agentId) => <option key={agentId} value={agentId}>{agentId}</option>)}
                    </select>
                    {candidateAgentIds.length === 0 && (
                      <span role="alert" className="mt-1.5 block text-[10px] text-aegis-danger">
                        {text('collaboration.actionDialog.candidatesUnavailable', 'Approved agent candidates are unavailable. Refresh the run snapshot.')}
                      </span>
                    )}
                  </label>
                )}
                {action === 'WORK_ITEM_INPUT_APPEND' && selectedWorkItem && (
                  <div className="space-y-2.5">
                    <label className="block">
                      <FieldLabel>{text('collaboration.actionDialog.additionalInput', 'Input for the next attempt')}</FieldLabel>
                      <textarea
                        value={additionalInput}
                        onChange={(event) => setAdditionalInput(event.target.value)}
                        rows={5}
                        data-modal-initial-focus
                        placeholder={text('collaboration.actionDialog.additionalInputHint', 'Add facts, constraints, or corrections for the next attempt.')}
                        className="w-full resize-y rounded-md border border-aegis-border bg-aegis-input px-2.5 py-2 text-[11.5px] leading-5 text-aegis-text outline-none focus:border-aegis-primary/55"
                      />
                    </label>
                    <p className="rounded-md border border-aegis-primary/20 bg-aegis-primary/[0.05] px-3 py-2.5 text-[10.5px] leading-4 text-aegis-text-muted">
                      {text(
                        'collaboration.actionDialog.additionalInputPrivacy',
                        'This input is bound to exactly the next attempt. It cannot change an active attempt, is stored as internal execution data, and will not be shown here again.',
                      )}
                    </p>
                  </div>
                )}
                {action === 'WORK_ITEM_CANCEL' && selectedWorkItem && (
                  <label className="flex items-start gap-2.5 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] p-3 text-[10.5px] leading-4 text-aegis-text-muted">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5 accent-[rgb(var(--aegis-danger))]"
                    />
                    <span>
                      {text(
                        'collaboration.actionDialog.confirmWorkItemCancel',
                        'I understand that new dispatch will stop. Any active OpenClaw attempt for this work item will receive a real cancellation request; otherwise the item is cancelled immediately.',
                      )}
                    </span>
                  </label>
                )}
              </div>
            )}

            {action === 'ATTEMPT_RESOLVE_UNKNOWN' && (
              <div className="space-y-3">
                <label className="block">
                  <FieldLabel>{text('collaboration.actionDialog.unknownAttempt', 'Unknown attempt')}</FieldLabel>
                  <select
                    value={selectedEntityId}
                    onChange={(event) => {
                      setSelectedEntityId(event.target.value);
                      setAttemptResolution('');
                      setConfirmed(false);
                    }}
                    className={inputClassName}
                  >
                    <option value="">{text('collaboration.actionDialog.chooseAttempt', 'Choose an attempt')}</option>
                    {unknownAttempts.map((attempt) => (
                      <option key={attempt.id} value={attempt.id}>{attemptLabel(attempt)}</option>
                    ))}
                  </select>
                </label>
                {selectedUnknownAttempt && (
                  <div className="rounded-md bg-[rgb(var(--aegis-overlay)/0.035)] px-2.5 py-2 text-[10px] text-aegis-text-muted">
                    {text('collaboration.actionDialog.entityRevision', 'Entity revision')}: <span className="font-mono">{selectedUnknownAttempt.revision}</span>
                    {selectedUnknownAttempt.lastError && (
                      <div className="mt-1 break-words">{selectedUnknownAttempt.lastError}</div>
                    )}
                    <CollaborationAttemptIdentity
                      attempt={selectedUnknownAttempt}
                      translate={text}
                      className="mt-2 border-t border-aegis-border/70 pt-1.5"
                    />
                  </div>
                )}
                {selectedUnknownAttempt && (
                  <p className="rounded-md border border-aegis-warning/20 bg-aegis-warning/[0.05] px-3 py-2 text-[10.5px] leading-4 text-aegis-text-muted">
                    {text(
                      'collaboration.actionDialog.verifyUnknownIdentity',
                      'Verify the exact OpenClaw Task, Run, and worker session before confirming an outcome.',
                    )}
                  </p>
                )}
                <label className="block">
                  <FieldLabel>{text('collaboration.actionDialog.unknownResolution', 'Confirmed outcome')}</FieldLabel>
                  <select
                    value={attemptResolution}
                    onChange={(event) => {
                      setAttemptResolution(event.target.value as CollaborationAttemptUnknownResolution | '');
                      setConfirmed(false);
                    }}
                    className={inputClassName}
                  >
                    <option value="">{text('collaboration.actionDialog.chooseResolution', 'Choose the confirmed outcome')}</option>
                    {availableAttemptResolutions.map((resolution) => (
                      <option key={resolution} value={resolution}>
                        {text(`collaboration.attemptResolution.${resolution}`, resolution)}
                      </option>
                    ))}
                  </select>
                </label>
                {attemptResolution === 'ABANDONED' && (
                  <label className="flex items-start gap-2.5 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] p-3 text-[10.5px] leading-4 text-aegis-text-muted">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      className="mt-0.5 accent-[rgb(var(--aegis-danger))]"
                    />
                    <span>
                      {text(
                        'collaboration.actionDialog.confirmResidualRisk',
                        'I accept the residual risk: the original worker may still finish or produce side effects after this attempt is abandoned.',
                      )}
                    </span>
                  </label>
                )}
              </div>
            )}

            {action === 'PARTIAL' && (
              <div className="space-y-3">
                <div>
                  <FieldLabel>{text('collaboration.actionDialog.waiveItems', 'Work items to waive')}</FieldLabel>
                  <div className="divide-y divide-aegis-border rounded-md border border-aegis-border">
                    {partialItems.map((item) => (
                      <label key={item.id} className="flex min-w-0 items-start gap-2.5 px-2.5 py-2.5 text-[11px] text-aegis-text-secondary">
                        <input
                          type="checkbox"
                          checked={selectedLogicalIds.includes(item.logicalId)}
                          onChange={(event) => setSelectedLogicalIds((current) => event.target.checked
                            ? [...new Set([...current, item.logicalId])]
                            : current.filter((id) => id !== item.logicalId))}
                          className="mt-0.5 accent-[rgb(var(--aegis-primary))]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">{item.title}</span>
                          <span className="mt-0.5 block font-mono text-[9.5px] text-aegis-text-dim">{item.logicalId} / rev {item.revision}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                {matchingPartialPreview && (
                  <div className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.06] p-3 text-[10.5px] text-aegis-text-muted">
                    <div className="flex items-center gap-2 font-medium text-aegis-warning">
                      <AlertTriangle size={13} aria-hidden />
                      {text('collaboration.actionDialog.serverImpact', 'Server-confirmed impact')}
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt>{text('collaboration.actionDialog.waived', 'Waived')}</dt>
                      <dd className="break-words font-mono">{matchingPartialPreview.closure.waiveIds.join(', ') || '-'}</dd>
                      <dt>{text('collaboration.actionDialog.blocked', 'Blocked descendants')}</dt>
                      <dd className="break-words font-mono">{matchingPartialPreview.closure.blockedDescendantIds.join(', ') || '-'}</dd>
                      <dt>{text('collaboration.actionDialog.active', 'Active attempts')}</dt>
                      <dd className="break-words font-mono">{matchingPartialPreview.closure.activeIds.join(', ') || '-'}</dd>
                    </dl>
                    <label className="mt-3 flex items-start gap-2 border-t border-aegis-warning/20 pt-2.5">
                      <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-[rgb(var(--aegis-primary))]" />
                      <span>{text('collaboration.actionDialog.confirmPartial', 'I reviewed this closure and accept the partial result.')}</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {(action === 'DELIVERY_RETRY' || action === 'DELIVERY_RETARGET' || action === 'DELIVERY_ABANDON') && (
              <div className="space-y-3">
                <label className="block">
                  <FieldLabel>{text('collaboration.actionDialog.delivery', 'Delivery')}</FieldLabel>
                  <select value={selectedEntityId} onChange={(event) => selectDelivery(event.target.value)} className={inputClassName}>
                    <option value="">{text('collaboration.actionDialog.chooseDelivery', 'Choose a delivery')}</option>
                    {eligibleDeliveries.map((delivery) => (
                      <option key={delivery.id} value={delivery.id}>{deliveryLabel(delivery)}</option>
                    ))}
                  </select>
                </label>
                {selectedDelivery && (
                  <div className="rounded-md bg-[rgb(var(--aegis-overlay)/0.035)] px-2.5 py-2 text-[10px] text-aegis-text-muted">
                    {text('collaboration.actionDialog.entityRevision', 'Entity revision')}: <span className="font-mono">{selectedDelivery.revision}</span>
                  </div>
                )}
                {action === 'DELIVERY_RETRY' && selectedDelivery?.status === 'UNKNOWN' && (
                  <div className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.06] p-3 text-[10.5px] leading-4 text-aegis-text-muted">
                    <strong className="block font-semibold text-aegis-warning">{text('collaboration.actionDialog.unknownDelivery', 'The previous delivery outcome is unknown.')}</strong>
                    {text('collaboration.actionDialog.sameDeliveryReconcile', 'JunQi will reconcile the original delivery with its existing OpenClaw receipt.')}
                  </div>
                )}
                {action === 'DELIVERY_RETARGET' && selectedDelivery && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {REQUIRED_ORIGIN_FIELDS.map((field) => (
                      <label key={field} className={field === 'sessionKey' || field === 'nativeMessageId' ? 'sm:col-span-2' : undefined}>
                        <FieldLabel>{field}</FieldLabel>
                        <input value={target[field]} onChange={(event) => setTarget((current) => ({ ...current, [field]: event.target.value }))} className={inputClassName} />
                      </label>
                    ))}
                    {OPTIONAL_ORIGIN_FIELDS.map((field) => (
                      <label key={field} className={field === 'target' ? 'sm:col-span-2' : undefined}>
                        <FieldLabel optional>{field}</FieldLabel>
                        <input value={target[field]} onChange={(event) => setTarget((current) => ({ ...current, [field]: event.target.value }))} className={inputClassName} />
                      </label>
                    ))}
                  </div>
                )}
                {action === 'DELIVERY_ABANDON' && selectedDelivery && (
                  <label className="flex items-start gap-2.5 rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] p-3 text-[10.5px] leading-4 text-aegis-text-muted">
                    <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-[rgb(var(--aegis-danger))]" />
                    <span>{text('collaboration.actionDialog.confirmAbandon', 'I understand that abandoning delivery cancels this run without writing the final result to the transcript.')}</span>
                  </label>
                )}
              </div>
            )}

            {action === 'CLONE' && (
              <label className="block">
                <FieldLabel optional>{text('collaboration.actionDialog.cloneGoal', 'New goal')}</FieldLabel>
                <textarea
                  value={cloneGoal}
                  onChange={(event) => setCloneGoal(event.target.value)}
                  rows={3}
                  placeholder={snapshot.goal}
                  className="w-full resize-y rounded-md border border-aegis-border bg-aegis-input px-2.5 py-2 text-[11.5px] leading-5 text-aegis-text outline-none focus:border-aegis-primary/55"
                />
              </label>
            )}

            {action === 'DELETE' && (
              <div className="rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.06] p-3 text-[10.5px] leading-4 text-aegis-text-muted">
                <div className="flex items-center gap-2 font-semibold text-aegis-danger">
                  <ShieldAlert size={14} aria-hidden />
                  {text('collaboration.actionDialog.deleteWarning', 'Permanent deletion')}
                </div>
                {matchingDeletePreview ? (
                  <>
                    <p className="mt-2">{text('collaboration.actionDialog.deletePreviewReady', 'The server verified the current run revision. This token expires automatically.')}</p>
                    <div className="mt-2 break-all rounded-md bg-[rgb(var(--aegis-overlay)/0.035)] px-2 py-1.5 font-mono text-[9.5px]" data-delete-digest>
                      {matchingDeletePreview.digest}
                    </div>
                    {flowReconciliationBlocker && (
                      <section
                        aria-labelledby="flow-reconciliation-blocker-title"
                        className="mt-3 rounded-md border border-aegis-danger/30 bg-[rgb(var(--aegis-overlay)/0.035)] p-2.5"
                        data-flow-reconciliation-blocker
                      >
                        <h3 id="flow-reconciliation-blocker-title" className="font-semibold text-aegis-danger">
                          {text('collaboration.actionDialog.flowReconciliationBlockerTitle', 'Flow reconciliation is unresolved')}
                        </h3>
                        <p id="flow-reconciliation-blocker-description" className="mt-1.5">
                          {text('collaboration.actionDialog.flowReconciliationBlockerMessage', 'Deletion cannot preserve this pending Flow reconciliation. Continuing will permanently abandon it and retain the reason in the audit record.')}
                        </p>
                        <dl className="mt-2 grid min-w-0 grid-cols-1 gap-1.5 sm:grid-cols-2">
                          <div className="min-w-0">
                            <dt className="text-aegis-text-dim">{text('collaboration.actionDialog.flowCommandId', 'Command ID')}</dt>
                            <dd className="break-all font-mono text-[9.5px] text-aegis-text" data-flow-command-id>{flowReconciliationBlocker.commandId}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-aegis-text-dim">{text('collaboration.actionDialog.flowCommandStatus', 'Command status')}</dt>
                            <dd className="break-all font-mono text-[9.5px] text-aegis-text" data-flow-command-status>{flowReconciliationBlocker.commandStatus}</dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-aegis-text-dim">{text('collaboration.actionDialog.managedFlowId', 'Managed Flow ID')}</dt>
                            <dd className="break-all font-mono text-[9.5px] text-aegis-text" data-managed-flow-id>
                              {flowReconciliationBlocker.flowId ?? text('collaboration.actionDialog.notAvailable', 'Not available')}
                            </dd>
                          </div>
                          <div className="min-w-0">
                            <dt className="text-aegis-text-dim">{text('collaboration.actionDialog.managedFlowRevision', 'Managed Flow revision')}</dt>
                            <dd className="break-all font-mono text-[9.5px] text-aegis-text" data-managed-flow-revision>
                              {flowReconciliationBlocker.flowRevision ?? text('collaboration.actionDialog.notAvailable', 'Not available')}
                            </dd>
                          </div>
                          <div className="min-w-0 sm:col-span-2">
                            <dt className="text-aegis-text-dim">{text('collaboration.actionDialog.flowReconciliationDiagnostic', 'Diagnostic')}</dt>
                            <dd className="break-words text-aegis-text" data-flow-reconciliation-diagnostic>
                              {flowReconciliationBlocker.diagnostic ?? text('collaboration.actionDialog.notAvailable', 'Not available')}
                            </dd>
                          </div>
                        </dl>
                        <label className="mt-2.5 block" htmlFor="flow-abandonment-reason">
                          <FieldLabel>{text('collaboration.actionDialog.flowAbandonmentReason', 'Reason for abandonment')}</FieldLabel>
                          <textarea
                            id="flow-abandonment-reason"
                            value={abandonmentReason}
                            onChange={(event) => {
                              setAbandonmentReason(event.target.value);
                              if (!event.target.value.trim()) setConfirmed(false);
                            }}
                            rows={3}
                            required
                            aria-describedby="flow-reconciliation-blocker-description"
                            placeholder={text('collaboration.actionDialog.flowAbandonmentReasonPlaceholder', 'Record why deleting now is safer than retrying reconciliation.')}
                            className="w-full resize-y rounded-md border border-aegis-danger/25 bg-aegis-input px-2.5 py-2 text-[11.5px] leading-5 text-aegis-text outline-none focus:border-aegis-danger/55"
                            data-flow-abandonment-reason
                          />
                        </label>
                        <label className="mt-2.5 flex items-start gap-2">
                          <input
                            type="checkbox"
                            checked={flowAbandonmentConfirmed}
                            onChange={(event) => {
                              setFlowAbandonmentConfirmed(event.target.checked);
                              if (!event.target.checked) setConfirmed(false);
                            }}
                            required
                            aria-describedby="flow-reconciliation-blocker-description"
                            className="mt-0.5 accent-[rgb(var(--aegis-danger))]"
                            data-confirm-flow-abandonment
                          />
                          <span>{text('collaboration.actionDialog.confirmFlowReconciliationAbandonment', 'I accept that this unresolved Flow reconciliation will be abandoned and cannot be resumed after deletion.')}</span>
                        </label>
                      </section>
                    )}
                    <label className={cn(
                      'mt-3 flex items-start gap-2 border-t border-aegis-danger/20 pt-2.5',
                      !flowAbandonmentReady && 'opacity-50',
                    )}>
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={!flowAbandonmentReady}
                        onChange={(event) => setConfirmed(event.target.checked)}
                        aria-describedby={flowReconciliationBlocker ? 'flow-reconciliation-blocker-description' : undefined}
                        className="mt-0.5 accent-[rgb(var(--aegis-danger))] disabled:cursor-not-allowed"
                        data-confirm-delete
                      />
                      <span>{text('collaboration.actionDialog.confirmDelete', 'I reviewed the server digest and want to permanently delete this run and its audit records.')}</span>
                    </label>
                  </>
                ) : (
                  <p className="mt-2">{text('collaboration.actionDialog.deletePreviewFirst', 'Request a server preview before confirming deletion. No deletion occurs during preview.')}</p>
                )}
              </div>
            )}

            {!['PLAN_REVISE', 'PLAN_APPROVE', 'WORK_ITEM_INPUT_APPEND', 'WORK_ITEM_CANCEL', 'WORK_ITEM_RETRY', 'WORK_ITEM_REASSIGN', 'ATTEMPT_RESOLVE_UNKNOWN', 'PARTIAL', 'DELIVERY_RETRY', 'DELIVERY_RETARGET', 'DELIVERY_ABANDON', 'CLONE', 'DELETE'].includes(action) && (
              <p className="text-[11px] leading-4 text-aegis-text-muted">
                {text('collaboration.actionDialog.directAction', 'This command will be sent with the displayed run revision.')}
              </p>
            )}

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-md bg-aegis-danger/[0.07] px-3 py-2.5 text-[10.5px] leading-4 text-aegis-danger">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-aegis-border px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-8 rounded-md px-3 text-[11px] font-medium text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)] hover:text-aegis-text disabled:opacity-45"
            >
              {text('common.cancel', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={!valid || busy}
              aria-busy={busy || undefined}
              className={cn(
                'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                action === 'DELETE' || action === 'DELIVERY_ABANDON' || action === 'WORK_ITEM_CANCEL'
                  ? 'border-aegis-danger/30 bg-aegis-danger/[0.08] text-aegis-danger hover:bg-aegis-danger/[0.13]'
                  : 'border-aegis-primary/35 bg-aegis-primary/[0.1] text-aegis-primary hover:bg-aegis-primary/[0.16]',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
              <span>{buttonLabel}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
