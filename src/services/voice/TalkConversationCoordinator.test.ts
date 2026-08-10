import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  TalkGatewayEvent,
  TalkRelayEvent,
} from '@/services/gateway/talkEventBridge';
import type { TalkCatalog, TalkSession } from '@/services/gateway/talkTypes';
import type { TalkGatewayConnectionClient } from '@/services/gateway/TalkGatewayClient';
import { TalkGatewayUnavailableError } from '@/services/gateway/TalkGatewayClient';
import {
  TalkConversationCoordinator,
  shouldCancelTalkOutput,
  type TalkConversationDependencies,
} from './TalkConversationCoordinator';

const INPUT_FORMAT = { encoding: 'pcm16' as const, sampleRateHz: 24_000, channels: 1 };
const OUTPUT_FORMAT = { encoding: 'pcm16' as const, sampleRateHz: 48_000, channels: 2 };

function session(sessionId = 'talk-1'): TalkSession {
  return {
    sessionId,
    provider: 'relay-provider',
    inputAudioFormat: { ...INPUT_FORMAT },
    outputAudioFormat: { ...OUTPUT_FORMAT },
  };
}

function event(
  type: TalkGatewayEvent['type'],
  seq: number,
  options: {
    sessionId?: string;
    turnId?: string | null;
    payload?: unknown;
  } = {},
): TalkGatewayEvent {
  return {
    id: `event-${seq}`,
    type,
    sessionId: options.sessionId ?? 'talk-1',
    turnId: options.turnId === undefined ? 'turn-1' : options.turnId,
    seq,
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    payload: options.payload ?? {},
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createHarness(
  clientOverrides: Partial<Omit<TalkGatewayConnectionClient, 'connectionId'>> = {},
  dependencyOverrides: Partial<Omit<TalkConversationDependencies, 'client'>> = {},
) {
  let listener: ((value: TalkGatewayEvent) => void) | null = null;
  let relayListener: ((value: TalkRelayEvent) => void) | null = null;
  const calls: string[] = [];
  const connectionOperations: Omit<TalkGatewayConnectionClient, 'connectionId'> = {
    getCatalog: async (): Promise<TalkCatalog> => ({
      modes: ['realtime'],
      transports: ['gateway-relay'],
      brains: ['agent-consult'],
      speech: { providers: [] },
      transcription: { providers: [] },
      realtime: { ready: true, activeProvider: 'relay-provider', providers: [] },
    }),
    createRealtimeRelay: async () => session(),
    appendAudio: async (_sessionId, _audioBase64, timestamp, signal) => {
      calls.push(`append:${timestamp}:${signal?.aborted === false ? 'active' : 'missing'}`);
    },
    acknowledgeMark: async (_sessionId, markName) => { calls.push(`ack-mark:${markName}`); },
    cancelOutput: async (_sessionId, turnId, reason) => {
      calls.push(`cancel-output:${turnId ?? ''}:${reason ?? 'barge-in'}`);
    },
    close: async (sessionId) => { calls.push(`close:${sessionId}`); },
    startAgentConsult: async (_sessionKey, _sessionId, callId) => {
      calls.push(`start-consult:${callId}`);
      return { runId: `run-${callId}`, idempotencyKey: `idem-${callId}` };
    },
    waitForAgentConsult: async (runId) => {
      calls.push(`wait-consult:${runId}`);
      return `result-${runId}`;
    },
    steerAgent: async (_sessionId, _sessionKey, input) => {
      calls.push(`steer:${input.mode ?? ''}:${input.text}`);
      return { ok: true, mode: input.mode, message: '已处理' };
    },
    submitToolResult: async (_sessionId, callId, result, options) => {
      calls.push(`submit-tool:${callId}:${JSON.stringify(result)}:${options?.willContinue === true ? 'continue' : 'final'}`);
    },
    abortAgentConsult: async (sessionKey, runId) => {
      calls.push(`abort-consult:${sessionKey}:${runId}`);
    },
    ...clientOverrides,
  };
  const client: TalkConversationDependencies['client'] = {
    bindConnection: (connectionId) => ({ connectionId, ...connectionOperations }),
    subscribe: (next) => {
      listener = next;
      return () => { if (listener === next) listener = null; };
    },
    subscribeRelay: (next) => {
      relayListener = next;
      return () => { if (relayListener === next) relayListener = null; };
    },
  };
  const dependencies: TalkConversationDependencies = {
    client,
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: (connectionId) => connectionId === 'connection-a',
    interruptLocalOutput: () => { calls.push('interrupt-local'); },
    playOutput: async () => {
      calls.push('play-output');
      return 'queued' as const;
    },
    finishOutput: async () => { calls.push('finish-output'); },
    stopOutput: async () => { calls.push('stop-output'); },
    now: () => 1_234,
    ...dependencyOverrides,
  };
  const coordinator = new TalkConversationCoordinator(dependencies);
  return {
    calls,
    coordinator,
    emit: (value: TalkGatewayEvent) => listener?.(value),
    emitRelay: (value: TalkRelayEvent) => relayListener?.(value),
    emitAudio: (seq: number, audioBase64 = 'AA==') => {
      relayListener?.({
        type: 'audio',
        relaySessionId: 'talk-1',
        turnId: 'turn-1',
        audioBase64,
      });
      listener?.(event('output.audio.delta', seq));
    },
  };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

test('Talk 会话保留 Gateway 确认的音频格式并发送匹配的 PCM', async () => {
  const harness = createHarness();
  const opened = await harness.coordinator.acceptInput('agent:main:main');
  assert.equal(opened.snapshot.phase, 'listening');
  assert.deepEqual(opened.snapshot.inputAudioFormat, INPUT_FORMAT);
  assert.deepEqual(opened.snapshot.outputAudioFormat, OUTPUT_FORMAT);
  assert.equal(harness.coordinator.appendPcm({ data: 'AA==', sampleRateHz: 24_000, channels: 1 }), true);
  await flush();
  assert.ok(harness.calls.includes('append:1234:active'));
});

test('Talk 目录未就绪时保留官方失败原因而不是伪装成普通连接错误', async () => {
  const harness = createHarness({
    createRealtimeRelay: async () => {
      throw new TalkGatewayUnavailableError(
        'Gateway realtime Talk provider is not ready',
        'realtime_not_ready',
      );
    },
  });
  const opened = await harness.coordinator.acceptInput('agent:main:main');
  assert.equal(opened.snapshot.phase, 'error');
  assert.equal(opened.snapshot.error, 'talk_realtime_not_ready');
});

test('Talk 输入只保留四个在途请求并丢弃已经过期的新帧', async () => {
  const pending: Array<ReturnType<typeof deferred<void>>> = [];
  const harness = createHarness({
    appendAudio: async () => {
      const request = deferred<void>();
      pending.push(request);
      return request.promise;
    },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  const frame = { data: 'AA==', sampleRateHz: 24_000, channels: 1 };
  assert.deepEqual([0, 1, 2, 3].map(() => harness.coordinator.appendPcm(frame)), [true, true, true, true]);
  assert.equal(harness.coordinator.appendPcm(frame), false);
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');
  pending.forEach((request) => request.resolve());
  await flush();
});

test('Stop 会中止当前 Talk 会话尚未完成的音频追加请求', async () => {
  let appendSignal: AbortSignal | undefined;
  const harness = createHarness({
    appendAudio: async (_sessionId, _audioBase64, _timestamp, signal) => {
      appendSignal = signal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.coordinator.appendPcm({ data: 'AA==', sampleRateHz: 24_000, channels: 1 });
  assert.equal(appendSignal?.aborted, false);
  await harness.coordinator.stop();
  assert.equal(appendSignal?.aborted, true);
});

test('说话打断会先停止本地播放再调用官方输出取消', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emit(event('output.audio.started', 1));
  await harness.coordinator.interrupt();
  assert.deepEqual(harness.calls, ['interrupt-local', 'stop-output', 'cancel-output:turn-1:barge-in']);
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');
});

test('并发说话打断只向当前 Talk 会话发送一次输出取消', async () => {
  const cancellation = deferred<void>();
  let cancellationCount = 0;
  const harness = createHarness({
    cancelOutput: async () => {
      cancellationCount += 1;
      await cancellation.promise;
    },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emit(event('output.audio.started', 1));
  const first = harness.coordinator.interrupt();
  const second = harness.coordinator.interrupt();
  assert.equal(cancellationCount, 0);
  await flush();
  assert.equal(cancellationCount, 1);
  cancellation.resolve();
  await Promise.all([first, second]);
  assert.equal(cancellationCount, 1);
});

test('Stop 停止当前 Talk 轮次并关闭中继但不修改 OpenClaw 会话身份', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emit(event('turn.started', 1));
  harness.calls.length = 0;
  await harness.coordinator.stop();
  assert.deepEqual(harness.calls, ['stop-output', 'close:talk-1']);
  assert.equal(harness.coordinator.getSnapshot().phase, 'idle');
  assert.equal(harness.coordinator.getSnapshot().sessionKey, null);
});

test('转写增量按轮次累积而最终文本替换临时内容', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emit(event('turn.started', 1));
  harness.emit(event('transcript.delta', 2, { payload: { text: '你好' } }));
  harness.emit(event('transcript.delta', 3, { payload: { text: '，世界' } }));
  assert.equal(harness.coordinator.getSnapshot().userTranscript, '你好，世界');
  harness.emit(event('transcript.done', 4, { payload: { text: '你好，世界。' } }));
  harness.emit(event('output.text.delta', 5, { payload: { text: '正在' } }));
  harness.emit(event('output.text.delta', 6, { payload: { text: '处理' } }));
  assert.equal(harness.coordinator.getSnapshot().assistantText, '正在处理');
  harness.emit(event('output.text.done', 7, { payload: { text: '已经处理完成。' } }));
  assert.equal(harness.coordinator.getSnapshot().assistantText, '已经处理完成。');
});

test('官方 Talk consult 在同一会话启动 run 并回传最终结果', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'call-1',
    name: 'openclaw_agent_consult',
    args: { question: '检查状态' },
    forced: false,
  });
  await flush();
  await flush();
  assert.deepEqual(harness.calls, [
    'start-consult:call-1',
    'wait-consult:run-call-1',
    'submit-tool:call-1:{"result":"result-run-call-1"}:final',
  ]);
});

test('Talk consult 最终结果等待原生输出排空后再交给 provider', async () => {
  const finished = deferred<void>();
  const harness = createHarness({}, {
    finishOutput: async () => finished.promise,
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitAudio(1);
  harness.emit(event('output.audio.done', 2));
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'call-delayed',
    name: 'openclaw_agent_consult',
    args: { question: '等待播报' },
    forced: false,
  });
  await flush();
  assert.equal(harness.calls.some((call) => call.startsWith('submit-tool:call-delayed:')), false);
  finished.resolve();
  await flush();
  await flush();
  assert.equal(harness.calls.some((call) => call.startsWith('submit-tool:call-delayed:')), true);
});

test('provider 取消工具调用时按精确 runId 中止且不提交迟到结果', async () => {
  const harness = createHarness({
    waitForAgentConsult: async (_runId, signal) => new Promise<string>((_resolve, reject) => {
      const abort = () => reject(new Error('aborted'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    }),
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'call-cancelled',
    name: 'openclaw_agent_consult',
    args: { question: '长任务' },
    forced: false,
  });
  await flush();
  harness.emitRelay({
    type: 'toolCallCancelled',
    relaySessionId: 'talk-1',
    callId: 'call-cancelled',
  });
  await flush();
  await flush();
  assert.ok(harness.calls.includes('abort-consult:agent:main:main:run-call-cancelled'));
  assert.equal(harness.calls.some((call) => call.startsWith('submit-tool:call-cancelled:')), false);
});

test('Stop 在 consult 启动确认迟到时仍中止确认返回的精确 run', async () => {
  const start = deferred<{ runId: string; idempotencyKey: string }>();
  const harness = createHarness({
    startAgentConsult: async () => start.promise,
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'call-late',
    name: 'openclaw_agent_consult',
    args: { question: '长任务' },
    forced: false,
  });
  await flush();
  await harness.coordinator.stop();
  start.resolve({ runId: 'run-late', idempotencyKey: 'idem-late' });
  await flush();
  await flush();
  assert.ok(harness.calls.includes('abort-consult:agent:main:main:run-late'));
  assert.equal(harness.calls.some((call) => call.startsWith('submit-tool:call-late:')), false);
});

test('强制 consult 先提交官方继续状态再提交最终结果', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'call-forced',
    name: 'openclaw_agent_consult',
    args: { question: '强制检查' },
    forced: true,
  });
  await flush();
  await flush();
  const submissions = harness.calls.filter((call) => call.startsWith('submit-tool:call-forced:'));
  assert.equal(submissions.length, 2);
  assert.match(submissions[0] ?? '', /"status":"working".*:continue$/);
  assert.match(submissions[1] ?? '', /"result":"result-run-call-forced".*:final$/);
});

test('官方 Talk control 由 Gateway steer 执行并回传原生结果', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'toolCall',
    relaySessionId: 'talk-1',
    callId: 'control-1',
    name: 'openclaw_agent_control',
    args: { text: '报告状态', mode: 'status' },
    forced: false,
  });
  await flush();
  await flush();
  assert.ok(harness.calls.includes('steer:status:报告状态'));
  assert.ok(harness.calls.some((call) => call.startsWith('submit-tool:control-1:{"ok":true')));
});

test('输出 PCM 串行进入原生队列并在播放完成后恢复监听', async () => {
  const firstPlayback = deferred<'queued' | 'overflow'>();
  const formats: unknown[] = [];
  let finishes = 0;
  const harness = createHarness({}, {
    playOutput: async (_audio, format) => {
      formats.push(format);
      return firstPlayback.promise;
    },
    finishOutput: async () => { finishes += 1; },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emit(event('output.audio.started', 1));
  harness.emitAudio(2);
  harness.emit(event('output.audio.done', 3));
  await flush();
  assert.equal(finishes, 0);
  assert.deepEqual(formats, [OUTPUT_FORMAT]);
  firstPlayback.resolve('queued');
  await flush();
  assert.equal(finishes, 1);
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');
});

test('官方播放标记只在原生输出真正排空后确认', async () => {
  const finished = deferred<void>();
  const operations: string[] = [];
  const harness = createHarness({
    acknowledgeMark: async (_sessionId, markName) => { operations.push(`ack:${markName}`); },
  }, {
    finishOutput: async () => {
      operations.push('finish:start');
      await finished.promise;
      operations.push('finish:end');
    },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emitAudio(1);
  await flush();
  harness.emitRelay({
    type: 'mark',
    relaySessionId: 'talk-1',
    turnId: 'turn-1',
    markName: 'mark-1',
  });
  harness.emit(event('output.audio.done', 2, { payload: { markName: 'mark-1' } }));
  await flush();
  assert.deepEqual(operations, ['finish:start']);
  finished.resolve();
  await flush();
  await flush();
  assert.deepEqual(operations, ['finish:start', 'finish:end', 'ack:mark-1']);
});

test('官方 clear 立即停止原生输出并围栏同一轮次的迟到音频', async () => {
  let finishes = 0;
  let stops = 0;
  let plays = 0;
  const harness = createHarness({}, {
    playOutput: async () => {
      plays += 1;
      return 'queued' as const;
    },
    finishOutput: async () => { finishes += 1; },
    stopOutput: async () => { stops += 1; },
  });
  await harness.coordinator.acceptInput('agent:main:main');
  stops = 0;
  harness.emitAudio(1);
  await flush();
  assert.equal(plays, 1);
  harness.emitRelay({
    type: 'clear',
    relaySessionId: 'talk-1',
    turnId: 'turn-1',
  });
  harness.emit(event('output.audio.done', 2, { payload: { reason: 'clear' } }));
  await flush();
  assert.equal(stops, 1);
  assert.equal(finishes, 0);
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');

  harness.emitAudio(3);
  await flush();
  assert.equal(plays, 1);
});

test('当前会话收到畸形中继事件时关闭 Talk 而不继续消费', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitRelay({
    type: 'protocolError',
    relaySessionId: 'talk-1',
    issue: 'mark',
  });
  await flush();
  assert.equal(harness.coordinator.getSnapshot().phase, 'error');
  assert.equal(harness.coordinator.getSnapshot().error, 'talk_session_error');
  assert.ok(harness.calls.includes('close:talk-1'));
});

test('轮次先结束时仍等待原生音频队列完成后恢复监听', async () => {
  const playback = deferred<'queued' | 'overflow'>();
  const harness = createHarness({}, {
    playOutput: async () => playback.promise,
  });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emitAudio(1);
  harness.emit(event('turn.ended', 2));
  harness.emit(event('output.audio.done', 3));
  assert.equal(harness.coordinator.getSnapshot().phase, 'speaking');
  playback.resolve('queued');
  await flush();
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');
});

test('原生播放队列溢出时取消当前输出并继续监听', async () => {
  const harness = createHarness({}, { playOutput: async () => 'overflow' as const });
  await harness.coordinator.acceptInput('agent:main:main');
  harness.calls.length = 0;
  harness.emitAudio(1);
  await flush();
  await flush();
  assert.ok(harness.calls.includes('cancel-output:turn-1:playback-overflow'));
  assert.equal(harness.coordinator.getSnapshot().phase, 'listening');
});

test('会话被替换后立即围栏旧事件并保留可诊断错误', async () => {
  const harness = createHarness();
  await harness.coordinator.acceptInput('agent:main:main');
  harness.emit(event('session.replaced', 1, { turnId: null, payload: {} }));
  await flush();
  assert.equal(harness.coordinator.getSnapshot().phase, 'error');
  assert.equal(harness.coordinator.getSnapshot().error, 'talk_session_replaced');
  harness.emit(event('transcript.done', 2, { payload: { text: '过期内容' } }));
  assert.equal(harness.coordinator.getSnapshot().userTranscript, '');
});

test('并发启动只允许最新目标接管并关闭过期候选会话', async () => {
  const openings = new Map<string, ReturnType<typeof deferred<TalkSession>>>();
  const closed: string[] = [];
  const harness = createHarness({
    createRealtimeRelay: async (sessionKey) => {
      const request = deferred<TalkSession>();
      openings.set(sessionKey, request);
      return request.promise;
    },
    close: async (sessionId) => { closed.push(sessionId); },
  });
  const first = harness.coordinator.acceptInput('agent:main:first');
  await flush();
  const second = harness.coordinator.acceptInput('agent:main:second');
  await flush();
  openings.get('agent:main:second')?.resolve(session('talk-2'));
  const secondAcceptance = await second;
  openings.get('agent:main:first')?.resolve(session('talk-1'));
  const firstAcceptance = await first;
  assert.equal(harness.coordinator.getSnapshot().sessionKey, 'agent:main:second');
  assert.equal(harness.coordinator.getSnapshot().sessionId, 'talk-2');
  assert.deepEqual(closed, ['talk-1']);
  assert.equal(harness.coordinator.ownsLease(firstAcceptance.lease), false);
  assert.equal(await harness.coordinator.stopOwnedLease(firstAcceptance.lease), false);
  assert.equal(harness.coordinator.ownsLease(secondAcceptance.lease), true);
  assert.equal(harness.coordinator.getSnapshot().sessionId, 'talk-2');
});

test('空会话键不会覆盖或释放已经建立的 Talk 会话', async () => {
  const harness = createHarness();
  const active = await harness.coordinator.acceptInput('agent:main:main');
  const rejected = await harness.coordinator.acceptInput('  ');
  assert.equal(rejected.snapshot.phase, 'error');
  assert.equal(rejected.lease, null);
  assert.equal(harness.coordinator.ownsLease(active.lease), true);
  assert.equal(harness.coordinator.getSnapshot().sessionId, 'talk-1');
});

test('外部中断只命中当前正在播报且允许取消的会话', () => {
  const snapshot = {
    phase: 'speaking' as const,
    sessionId: 'talk-1',
    sessionKey: 'agent:main:main',
    connectionId: 'connection-a',
    inputAudioFormat: INPUT_FORMAT,
    outputAudioFormat: OUTPUT_FORMAT,
    userTranscript: '',
    assistantText: '',
    error: null,
    errorDetail: null,
  };
  assert.equal(shouldCancelTalkOutput(snapshot, { cancelTalk: true, sessionKey: 'agent:main:main' }), true);
  assert.equal(shouldCancelTalkOutput(snapshot, { cancelTalk: false, sessionKey: 'agent:main:main' }), false);
  assert.equal(shouldCancelTalkOutput(snapshot, { cancelTalk: true, sessionKey: 'agent:other:main' }), false);
});
