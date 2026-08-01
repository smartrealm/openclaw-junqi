import type { AgentWorkspaceTaskStatus } from '@/stores/agentWorkspaceStore';

/**
 * One vocabulary for every surface that names a status.
 *
 * ActivityCenter, TimelinePage and the dynamic island each carried their own
 * table. They drifted: the same `running` read "运行中" in one place and
 * "执行中" in another, and each table covered a slightly different key set.
 * The task half is keyed on `AgentWorkspaceTaskStatus`, which is the authority.
 */

/** Session activity states. Not task statuses - a session is not a task. */
export type SessionActivityStatus = 'running' | 'queued' | 'idle' | 'stopped' | 'unknown';

export type LabelledStatus = AgentWorkspaceTaskStatus | SessionActivityStatus;

const TASK_STATUSES: readonly AgentWorkspaceTaskStatus[] = [
  'todo',
  'pending',
  'running',
  'input_required',
  'awaiting_review',
  'detached',
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
  ...SESSION_STATUSES.filter((status) => !TASK_STATUSES.includes(status as AgentWorkspaceTaskStatus)),
];

/** The i18n key for a status, or null when the value is not one we name. */
export function taskStatusLabelKey(status: string): string | null {
  return LABELLED_STATUSES.includes(status as LabelledStatus) ? `taskStatus.${status}` : null;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Resolves a status to display text. Unknown values fall back to the raw status
 * rather than to an invented label, so an upstream vocabulary change surfaces
 * as an untranslated string instead of a silently wrong one.
 */
export function resolveStatusLabel(status: string, t: Translate): string {
  const key = taskStatusLabelKey(status);
  return key ? t(key) : status;
}
