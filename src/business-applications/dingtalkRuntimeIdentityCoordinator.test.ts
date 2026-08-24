import test from 'node:test';
import assert from 'node:assert/strict';
import type { OpenClawToolsInvokeResult } from '@/services/gateway/OpenClawToolsInvokeClient';
import type { DingTalkRuntimeIdentityProjection } from './dingtalkTools';
import {
  DingTalkRuntimeIdentityCoordinator,
  selectCurrentDingTalkRuntimeIdentitySnapshot,
  type DingTalkRuntimeIdentityContext,
} from './dingtalkRuntimeIdentityCoordinator';

const contextA: DingTalkRuntimeIdentityContext = {
  connectionId: 'connection-a',
  sessionKey: 'agent:main:main',
  toolsRevision: 100,
};

const runtimeA: DingTalkRuntimeIdentityProjection = {
  available: true,
  runtimeError: null,
  currentProfile: 'corp-a:user-a',
  profiles: [],
  user: null,
};

const result: OpenClawToolsInvokeResult = {
  ok: true,
  toolName: 'junqi_dingtalk_runtime_status',
  output: { runtime: runtimeA },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

test('连接级预热快照会复用同一工具修订且不会重复调用 DWS', async () => {
  let invocations = 0;
  const coordinator = new DingTalkRuntimeIdentityCoordinator({
    isContextCurrent: () => true,
    invokeRuntimeStatus: async () => {
      invocations += 1;
      return result;
    },
    parseRuntimeStatus: () => runtimeA,
  });

  assert.equal(await coordinator.refresh(contextA), true);
  assert.equal(coordinator.getSnapshot()?.phase, 'settled');
  assert.equal(coordinator.getSnapshot()?.runtime?.currentProfile, 'corp-a:user-a');
  assert.equal(await coordinator.refresh(contextA), true);
  assert.equal(invocations, 1);
});

test('切换连接或 Session 后会丢弃旧预热请求的迟到结果', async () => {
  const pending = deferred<OpenClawToolsInvokeResult>();
  let currentContext = contextA;
  const coordinator = new DingTalkRuntimeIdentityCoordinator({
    isContextCurrent: (context) => (
      context.connectionId === currentContext.connectionId
      && context.sessionKey === currentContext.sessionKey
      && context.toolsRevision === currentContext.toolsRevision
    ),
    invokeRuntimeStatus: async () => pending.promise,
    parseRuntimeStatus: () => runtimeA,
  });

  const oldRefresh = coordinator.refresh(contextA);
  assert.equal(coordinator.getSnapshot()?.phase, 'loading');
  currentContext = {
    connectionId: 'connection-b',
    sessionKey: 'agent:legal:main',
    toolsRevision: 200,
  };
  coordinator.invalidate();
  pending.resolve(result);

  assert.equal(await oldRefresh, false);
  assert.equal(coordinator.getSnapshot(), null);
});

test('工具投影修订变化后必须重新核验 DWS 身份', async () => {
  let invocations = 0;
  let currentRevision = 100;
  const coordinator = new DingTalkRuntimeIdentityCoordinator({
    isContextCurrent: (context) => context.toolsRevision === currentRevision,
    invokeRuntimeStatus: async () => {
      invocations += 1;
      return result;
    },
    parseRuntimeStatus: () => runtimeA,
  });

  await coordinator.refresh(contextA);
  currentRevision = 101;
  await coordinator.refresh({ ...contextA, toolsRevision: currentRevision });

  assert.equal(invocations, 2);
  assert.equal(coordinator.getSnapshot()?.toolsRevision, 101);
});

test('目录只能使用当前工具修订已经结算的 DWS 身份', () => {
  const settled = {
    contextKey: 'connection-a\u0000agent:main:main',
    toolsRevision: 100,
    phase: 'settled' as const,
    runtime: runtimeA,
    error: null,
  };

  assert.equal(
    selectCurrentDingTalkRuntimeIdentitySnapshot(
      settled,
      settled.contextKey,
      100,
    ),
    settled,
  );
  assert.equal(
    selectCurrentDingTalkRuntimeIdentitySnapshot(
      settled,
      settled.contextKey,
      101,
    ),
    null,
  );
  assert.equal(
    selectCurrentDingTalkRuntimeIdentitySnapshot(
      { ...settled, toolsRevision: 101, phase: 'loading' },
      settled.contextKey,
      101,
    ),
    null,
  );
});

test('当前上下文失效时不会发布未经核验的身份结果', async () => {
  const coordinator = new DingTalkRuntimeIdentityCoordinator({
    isContextCurrent: () => false,
    invokeRuntimeStatus: async () => result,
    parseRuntimeStatus: () => runtimeA,
  });

  assert.equal(await coordinator.refresh(contextA), false);
  assert.equal(coordinator.publish(contextA, result), false);
  assert.equal(coordinator.getSnapshot(), null);
});
