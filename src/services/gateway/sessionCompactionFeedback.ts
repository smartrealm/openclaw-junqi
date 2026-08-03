import type { OpenClawSessionCompactionResult } from './OpenClawSessionCompactionClient';

export type SessionCompactionFeedbackType = 'error' | 'task_complete' | 'info';

export interface SessionCompactionFeedback {
  type: SessionCompactionFeedbackType;
  titleKey: string;
  bodyKey: string;
  reason?: string;
  fallbackReasonKey?: string;
}

export type SessionCompactionToast = (
  type: SessionCompactionFeedbackType,
  title: string,
  body: string,
) => void;

export type SessionCompactionTranslator = (
  key: string,
  options?: { reason: string },
) => string;

/** Classifies the narrow official compaction result without inventing lifecycle state. */
export function presentOpenClawSessionCompaction(
  result: OpenClawSessionCompactionResult,
): SessionCompactionFeedback {
  if (!result.ok) {
    return {
      type: 'error',
      titleKey: 'dashboard.compactFailedTitle',
      bodyKey: 'dashboard.compactFailedBody',
      reason: result.reason,
      fallbackReasonKey: 'dashboard.compactFailureReason',
    };
  }
  if (result.compacted) {
    return {
      type: 'task_complete',
      titleKey: 'dashboard.compactCompletedTitle',
      bodyKey: 'dashboard.compactCompletedBody',
    };
  }
  if (result.pending) {
    return {
      type: 'info',
      titleKey: 'dashboard.compactPendingTitle',
      bodyKey: 'dashboard.compactPendingBody',
    };
  }
  return {
    type: 'info',
    titleKey: 'dashboard.compactNoopTitle',
    bodyKey: 'dashboard.compactNoopBody',
    reason: result.reason,
    fallbackReasonKey: 'dashboard.compactNoopReason',
  };
}

/** Renders the shared feedback while leaving remote completion to Gateway events. */
export function notifyOpenClawSessionCompaction(
  result: OpenClawSessionCompactionResult,
  t: SessionCompactionTranslator,
  addToast: SessionCompactionToast,
): void {
  const feedback = presentOpenClawSessionCompaction(result);
  const reason = feedback.fallbackReasonKey
    ? feedback.reason?.trim() || t(feedback.fallbackReasonKey)
    : undefined;
  addToast(
    feedback.type,
    t(feedback.titleKey),
    reason === undefined ? t(feedback.bodyKey) : t(feedback.bodyKey, { reason }),
  );
}

export function notifyOpenClawSessionCompactionFailure(
  error: unknown,
  t: SessionCompactionTranslator,
  addToast: SessionCompactionToast,
): void {
  addToast(
    'error',
    t('dashboard.compactFailedTitle'),
    error instanceof Error ? error.message : String(error),
  );
}
