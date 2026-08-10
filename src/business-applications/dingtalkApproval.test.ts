import test from 'node:test';
import assert from 'node:assert/strict';
import { getDingTalkApprovalTraceInstanceId, hasDingTalkApprovalTrace, mergeDingTalkApprovalTraces, parseDingTalkApprovalTraceOutput } from './dingtalkApproval';

test('projects official approval instance fields from a DWS result envelope', () => {
  const trace = parseDingTalkApprovalTraceOutput({
    output: {
      details: {
        observedAt: '2026-08-10T10:00:00Z',
        data: {
          processInstanceId: 'instance-1',
          processCode: 'PROC-1',
          title: '报销审批',
          status: 'RUNNING',
          createTime: '2026-08-10T09:00:00Z',
        },
      },
    },
  });
  assert.equal(trace.instance?.processInstanceId, 'instance-1');
  assert.equal(trace.instance?.title, '报销审批');
  assert.equal(trace.observedAt, '2026-08-10T10:00:00Z');
  assert.equal(hasDingTalkApprovalTrace(trace), true);
});

test('projects official task and record fields without inventing missing nodes', () => {
  const trace = parseDingTalkApprovalTraceOutput({
    output: {
      details: {
        data: {
          tasks: [{ task_id: 'task-1', instance_id: 'instance-1', status: 'PENDING', action_type: '待审批', assignee: { userid: 'user-1' } }],
          records: [{ recordId: 'record-1', processInstanceId: 'instance-1', action_type: 'APPROVE', operator: { userid: 'user-2' }, operate_time: '2026-08-10T10:01:00Z', remark: '同意' }],
        },
      },
    },
  });
  assert.deepEqual(trace.tasks, [{ taskId: 'task-1', processInstanceId: 'instance-1', status: 'PENDING', action: '待审批', assigneeId: 'user-1' }]);
  assert.deepEqual(trace.records, [{ recordId: 'record-1', processInstanceId: 'instance-1', action: 'APPROVE', status: null, actorId: 'user-2', occurredAt: '2026-08-10T10:01:00Z', remark: '同意' }]);
});

test('keeps empty approval results as an explicit empty trace', () => {
  const trace = parseDingTalkApprovalTraceOutput({ output: { details: { data: { values: [] } } } });
  assert.deepEqual(trace, { instance: null, tasks: [], records: [], observedAt: null });
  assert.equal(hasDingTalkApprovalTrace(trace), false);
});

test('merges instance, task, and record reads into one trace', () => {
  const merged = mergeDingTalkApprovalTraces([
    parseDingTalkApprovalTraceOutput({ processInstanceId: 'instance-1', title: '审批实例' }),
    parseDingTalkApprovalTraceOutput({ tasks: [{ taskId: 'task-1', processInstanceId: 'instance-1' }] }),
    parseDingTalkApprovalTraceOutput({ records: [{ recordId: 'record-1', processInstanceId: 'instance-1', action: 'APPROVE' }] }),
  ]);
  assert.equal(merged.instance?.processInstanceId, 'instance-1');
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.records.length, 1);
});

test('gets the official instance identifier from task or record projections', () => {
  const trace = parseDingTalkApprovalTraceOutput({ records: [{ process_instance_id: 'instance-2' }] });
  assert.equal(getDingTalkApprovalTraceInstanceId(trace), 'instance-2');
});

test('uses the OpenClaw tool identity to classify unnamed DWS task arrays', () => {
  const trace = parseDingTalkApprovalTraceOutput({
    toolName: 'junqi_dingtalk_approval_tasks',
    output: {
      details: {
        toolName: 'junqi_dingtalk_approval_tasks',
        data: [{ task_id: 'task-2', instance_id: 'instance-3', status: 'PENDING' }],
      },
    },
  });
  assert.equal(trace.instance, null);
  assert.equal(trace.tasks.length, 1);
  assert.deepEqual(trace.records, []);
});

test('uses the OpenClaw tool identity to classify unnamed DWS record arrays', () => {
  const trace = parseDingTalkApprovalTraceOutput({
    output: {
      details: {
        toolName: 'junqi_dingtalk_approval_records',
        data: [{ record_id: 'record-2', instance_id: 'instance-4', action_type: 'APPROVE' }],
      },
    },
  });
  assert.equal(trace.instance, null);
  assert.deepEqual(trace.tasks, []);
  assert.equal(trace.records.length, 1);
});
