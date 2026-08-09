import type { OpenClawSessionCompactionResult } from '@/services/gateway/OpenClawSessionCompactionClient';

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

export class OpenClawSessionCompactionTargetError extends Error {
  constructor() {
    super('OPENCLAW_SESSION_COMPACTION_TARGET_REQUIRED');
    this.name = 'OpenClawSessionCompactionTargetError';
  }
}

export function requireOpenClawSessionCompactionTarget(value: string | null | undefined): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) throw new OpenClawSessionCompactionTargetError();
  return key;
}

/** 不虚构生命周期状态，只分类官方压缩结果。 */
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

/** 渲染统一反馈，远端终态仍只接受 Gateway 事件。 */
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
  if (error instanceof OpenClawSessionCompactionTargetError) {
    addToast(
      'error',
      t('dashboard.compactFailedTitle'),
      t('dashboard.compactSessionRequired'),
    );
    return;
  }
  addToast(
    'error',
    t('dashboard.compactFailedTitle'),
    error instanceof Error ? error.message : String(error),
  );
}
