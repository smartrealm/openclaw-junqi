/** 会话、任务账本与 Workshop 共用的已翻译状态词汇。 */
export type SessionActivityStatus = 'running' | 'queued' | 'idle' | 'stopped' | 'unknown';
export type TaskLedgerStatus =
  | 'todo'
  | 'pending'
  | 'running'
  | 'input_required'
  | 'awaiting_review'
  | 'interrupted'
  | 'done'
  | 'failed'
  | 'cancelled';
export type LabelledStatus = TaskLedgerStatus | SessionActivityStatus;

const TASK_STATUSES: readonly TaskLedgerStatus[] = [
  'todo',
  'pending',
  'running',
  'input_required',
  'awaiting_review',
  'interrupted',
  'done',
  'failed',
  'cancelled',
];

const SESSION_STATUSES: readonly SessionActivityStatus[] = [
  'running',
  'queued',
  'idle',
  'stopped',
  'unknown',
];

export const LABELLED_STATUSES: readonly LabelledStatus[] = [
  ...TASK_STATUSES,
  ...SESSION_STATUSES.filter((status) => !TASK_STATUSES.includes(status as TaskLedgerStatus)),
];

/** 已知状态才映射到翻译键，未知上游值保持原文。 */
export function taskStatusLabelKey(status: string): string | null {
  return LABELLED_STATUSES.includes(status as LabelledStatus) ? `taskStatus.${status}` : null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** 未知状态直接显示原文，避免为上游新增值编造本地语义。 */
export function resolveStatusLabel(status: string, t: Translate): string {
  const key = taskStatusLabelKey(status);
  return key ? t(key) : status;
}
