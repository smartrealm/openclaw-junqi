export interface DingTalkApprovalInstanceProjection {
  readonly processInstanceId: string | null;
  readonly processCode: string | null;
  readonly title: string | null;
  readonly status: string | null;
  readonly createdAt: string | null;
}

export interface DingTalkApprovalTaskProjection {
  readonly taskId: string | null;
  readonly processInstanceId: string | null;
  readonly status: string | null;
  readonly action: string | null;
  readonly assigneeId: string | null;
}

export interface DingTalkApprovalRecordProjection {
  readonly recordId: string | null;
  readonly processInstanceId: string | null;
  readonly action: string | null;
  readonly status: string | null;
  readonly actorId: string | null;
  readonly occurredAt: string | null;
  readonly remark: string | null;
}

export interface DingTalkApprovalTraceProjection {
  readonly instance: DingTalkApprovalInstanceProjection | null;
  readonly tasks: readonly DingTalkApprovalTaskProjection[];
  readonly records: readonly DingTalkApprovalRecordProjection[];
  readonly observedAt: string | null;
}

const ARRAY_KEYS = ['result', 'data', 'list', 'items', 'values', 'instances', 'tasks', 'records'] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function firstString(value: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const candidate = stringValue(value[key]);
    if (candidate) return candidate;
  }
  return null;
}

function nestedString(value: Record<string, unknown>, parent: string, keys: readonly string[]): string | null {
  const nested = record(value[parent]);
  return nested ? firstString(nested, keys) : null;
}

function arrays(value: Record<string, unknown>): unknown[] {
  for (const key of ARRAY_KEYS) {
    if (Array.isArray(value[key])) return value[key];
    const nested = record(value[key]);
    if (!nested) continue;
    for (const nestedKey of ARRAY_KEYS) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

function namedArray(value: Record<string, unknown>, key: 'tasks' | 'records'): unknown[] {
  if (Array.isArray(value[key])) return value[key];
  for (const containerKey of ['result', 'data'] as const) {
    const nested = record(value[containerKey]);
    if (nested && Array.isArray(nested[key])) return nested[key] as unknown[];
  }
  return [];
}

function unwrap(value: unknown): Record<string, unknown> | null {
  const outer = record(value);
  const output = record(outer?.output);
  const details = record(output?.details);
  return record(details?.data) ?? details ?? output ?? outer;
}

function sourceToolName(value: unknown): string | null {
  const outer = record(value);
  const output = record(outer?.output);
  const details = record(output?.details);
  return firstString(outer ?? {}, ['toolName'])
    ?? firstString(output ?? {}, ['toolName'])
    ?? firstString(details ?? {}, ['toolName']);
}

function projectInstance(value: unknown): DingTalkApprovalInstanceProjection | null {
  const item = record(value);
  if (!item) return null;
  const processInstanceId = firstString(item, ['processInstanceId', 'process_instance_id', 'instanceId', 'instance_id', 'id']);
  const processCode = firstString(item, ['processCode', 'process_code']);
  const title = firstString(item, ['title', 'processTitle', 'process_title', 'name']);
  const status = firstString(item, ['status', 'result', 'processResult', 'process_result']);
  const createdAt = firstString(item, ['createTime', 'create_time', 'gmtCreate', 'createdTime', 'created_at']);
  if (!processInstanceId && !processCode && !title && !status && !createdAt) return null;
  return { processInstanceId, processCode, title, status, createdAt };
}

function projectTask(value: unknown): DingTalkApprovalTaskProjection | null {
  const item = record(value);
  if (!item) return null;
  const taskId = firstString(item, ['taskId', 'task_id', 'id']);
  const processInstanceId = firstString(item, ['processInstanceId', 'process_instance_id', 'instanceId', 'instance_id'])
    ?? nestedString(item, 'task', ['instanceId', 'instance_id']);
  const status = firstString(item, ['status', 'taskStatus', 'task_status']) ?? nestedString(item, 'task', ['status']);
  const action = firstString(item, ['actionType', 'action_type', 'action']);
  const assigneeId = firstString(item, ['assigneeId', 'assignee_id']) ?? nestedString(item, 'assignee', ['userid', 'userId', 'user_id']);
  if (!taskId && !processInstanceId && !status && !action && !assigneeId) return null;
  return { taskId, processInstanceId, status, action, assigneeId };
}

function projectRecord(value: unknown): DingTalkApprovalRecordProjection | null {
  const item = record(value);
  if (!item) return null;
  const recordId = firstString(item, ['recordId', 'record_id', 'id']);
  const processInstanceId = firstString(item, ['processInstanceId', 'process_instance_id', 'instanceId', 'instance_id']);
  const action = firstString(item, ['actionType', 'action_type', 'action', 'type']);
  const status = firstString(item, ['status', 'result', 'processResult', 'process_result']);
  const actorId = firstString(item, ['operatorUserId', 'operator_userid', 'actorId', 'actor_id', 'userid', 'userId'])
    ?? nestedString(item, 'operator', ['userid', 'userId', 'user_id']);
  const occurredAt = firstString(item, ['operateTime', 'operate_time', 'createTime', 'create_time', 'time', 'occurredAt', 'occurred_at']);
  const remark = firstString(item, ['remark', 'comment', 'reason', 'content']);
  if (!recordId && !processInstanceId && !action && !status && !actorId && !occurredAt && !remark) return null;
  return { recordId, processInstanceId, action, status, actorId, occurredAt, remark };
}

function unique<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identity = key(value);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function parseDingTalkApprovalTraceOutput(value: unknown): DingTalkApprovalTraceProjection {
  const root = unwrap(value);
  if (!root) return { instance: null, tasks: [], records: [], observedAt: null };
  const outer = record(value);
  const output = record(outer?.output);
  const details = record(output?.details);
  const toolName = sourceToolName(value);
  const items = arrays(root);
  const taskItems = namedArray(root, 'tasks');
  const recordItems = namedArray(root, 'records');
  const sourceIsTasks = toolName === DINGTALK_APPROVAL_TASKS_TOOL;
  const sourceIsRecords = toolName === DINGTALK_APPROVAL_RECORDS_TOOL;
  const instance = sourceIsTasks || sourceIsRecords
    ? null
    : projectInstance(root) ?? items.map(projectInstance).find((item): item is DingTalkApprovalInstanceProjection => Boolean(item)) ?? null;
  const tasks = unique((taskItems.length ? taskItems : sourceIsTasks ? items : []).map(projectTask).filter((item): item is DingTalkApprovalTaskProjection => Boolean(item)), (item) => `${item.taskId ?? ''}:${item.processInstanceId ?? ''}:${item.status ?? ''}`);
  const records = unique((recordItems.length ? recordItems : sourceIsRecords ? items : []).map(projectRecord).filter((item): item is DingTalkApprovalRecordProjection => Boolean(item)), (item) => `${item.recordId ?? ''}:${item.occurredAt ?? ''}:${item.action ?? ''}`);
  return {
    instance,
    tasks,
    records,
    observedAt: firstString(details ?? root, ['observedAt', 'observed_at']) ?? null,
  };
}

export function hasDingTalkApprovalTrace(trace: DingTalkApprovalTraceProjection): boolean {
  return Boolean(trace.instance || trace.tasks.length || trace.records.length);
}

export function getDingTalkApprovalTraceInstanceId(trace: DingTalkApprovalTraceProjection): string | null {
  return trace.instance?.processInstanceId
    ?? trace.tasks.find((item) => item.processInstanceId)?.processInstanceId
    ?? trace.records.find((item) => item.processInstanceId)?.processInstanceId
    ?? null;
}

export function mergeDingTalkApprovalTraces(
  traces: readonly DingTalkApprovalTraceProjection[],
): DingTalkApprovalTraceProjection {
  const instance = traces.find((trace) => trace.instance)?.instance ?? null;
  const tasks = unique(traces.flatMap((trace) => trace.tasks), (item) => `${item.taskId ?? ''}:${item.processInstanceId ?? ''}:${item.status ?? ''}`);
  const records = unique(traces.flatMap((trace) => trace.records), (item) => `${item.recordId ?? ''}:${item.occurredAt ?? ''}:${item.action ?? ''}`);
  const observedAt = traces.flatMap((trace) => trace.observedAt ? [trace.observedAt] : []).sort().at(-1) ?? null;
  return { instance, tasks, records, observedAt };
}
import {
  DINGTALK_APPROVAL_RECORDS_TOOL,
  DINGTALK_APPROVAL_TASKS_TOOL,
} from './dingtalkTools';
