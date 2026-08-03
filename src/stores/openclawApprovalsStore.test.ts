import assert from 'node:assert/strict';
import test from 'node:test';
import { gateway } from '@/services/gateway';
import { useOpenClawApprovalsStore } from './openclawApprovalsStore';

const snapshot = (id: string) => ({
  approvals: [{
    kind: 'exec' as const,
    id,
    request: { command: `echo ${id}`, allowedDecisions: ['deny' as const] },
    createdAtMs: 1,
    expiresAtMs: 2,
  }],
  availability: { exec: 'available' as const, plugin: 'unavailable' as const },
});

test('keeps the newest approval snapshot when list requests overlap', async () => {
  const originalList = gateway.listPendingApprovals;
  let resolveFirst!: (value: ReturnType<typeof snapshot>) => void;
  let resolveSecond!: (value: ReturnType<typeof snapshot>) => void;
  let calls = 0;
  gateway.listPendingApprovals = async () => {
    calls += 1;
    return new Promise((resolve) => {
      if (calls === 1) resolveFirst = resolve;
      else resolveSecond = resolve;
    });
  };
  useOpenClawApprovalsStore.setState({ snapshot: null, loading: false, error: null, resolvingId: null });

  try {
    const first = useOpenClawApprovalsStore.getState().refresh(true, true);
    const second = useOpenClawApprovalsStore.getState().refresh(true, true);
    resolveSecond(snapshot('newer'));
    await second;
    resolveFirst(snapshot('older'));
    await first;
    assert.equal(useOpenClawApprovalsStore.getState().snapshot?.approvals[0]?.id, 'newer');
    assert.equal(useOpenClawApprovalsStore.getState().loading, false);
  } finally {
    gateway.listPendingApprovals = originalList;
  }
});

test('invalidates an in-flight list response when the Gateway disconnects', async () => {
  const originalList = gateway.listPendingApprovals;
  let resolveList!: (value: ReturnType<typeof snapshot>) => void;
  gateway.listPendingApprovals = async () => new Promise((resolve) => { resolveList = resolve; });
  useOpenClawApprovalsStore.setState({ snapshot: snapshot('before'), loading: false, error: null, resolvingId: null });

  try {
    const pending = useOpenClawApprovalsStore.getState().refresh(true, true);
    await useOpenClawApprovalsStore.getState().refresh(false, true);
    resolveList(snapshot('late'));
    await pending;
    assert.equal(useOpenClawApprovalsStore.getState().snapshot, null);
    assert.equal(useOpenClawApprovalsStore.getState().error, null);
  } finally {
    gateway.listPendingApprovals = originalList;
  }
});

test('loads unified approval history and appends cursor pages without duplicates', async () => {
  const originalHistory = gateway.listApprovalHistory;
  let calls = 0;
  gateway.listApprovalHistory = async (input = {}) => {
    calls += 1;
    if (input.cursor) {
      return {
        availability: 'available' as const,
        items: [{
          id: 'second',
          urlPath: '/approve/second',
          createdAtMs: 2,
          expiresAtMs: 3,
          resolvedAtMs: 4,
          status: 'denied' as const,
          reason: 'user' as const,
          decision: 'deny' as const,
          presentation: {
            kind: 'plugin' as const,
            title: 'Plugin approval',
            description: 'Second',
            severity: 'info' as const,
            allowedDecisions: ['allow-once', 'deny'] as const,
          },
        }],
      };
    }
    return {
      availability: 'available' as const,
      nextCursor: 'next',
      items: [{
        id: 'first',
        urlPath: '/approve/first',
        createdAtMs: 1,
        expiresAtMs: 2,
        resolvedAtMs: 3,
        status: 'allowed' as const,
        reason: 'user' as const,
        decision: 'allow-once' as const,
        presentation: {
          kind: 'exec' as const,
          commandText: 'echo first',
          allowedDecisions: ['allow-once', 'deny'] as const,
        },
      }],
    };
  };
  useOpenClawApprovalsStore.setState({
    history: null,
    historyLoading: false,
    historyError: null,
  });

  try {
    await useOpenClawApprovalsStore.getState().refreshHistory(true, true);
    await useOpenClawApprovalsStore.getState().loadMoreHistory(true);
    const history = useOpenClawApprovalsStore.getState().history;
    assert.equal(calls, 2);
    assert.deepEqual(history?.items.map((item) => item.id), ['first', 'second']);
    assert.equal(history?.nextCursor, undefined);
  } finally {
    gateway.listApprovalHistory = originalHistory;
  }
});
