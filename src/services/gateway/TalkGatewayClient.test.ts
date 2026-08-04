import assert from 'node:assert/strict';
import test from 'node:test';
import { TalkGatewayClient, TalkGatewayUnavailableError } from './TalkGatewayClient';
import type { TalkEventListener } from './talkEventBridge';
import type { GatewayRequestOptions } from './Connection';

function catalog() {
  return {
    modes: ['realtime', 'stt-tts', 'transcription'],
    transports: ['webrtc', 'provider-websocket', 'gateway-relay', 'managed-room'],
    brains: ['agent-consult', 'direct-tools', 'none'],
    speech: { providers: [] },
    transcription: { ready: false, providers: [] },
    realtime: {
      ready: true,
      activeProvider: 'relay-provider',
      providers: [{
        id: 'relay-provider',
        label: 'Relay provider',
        configured: true,
        modes: ['realtime'],
        transports: ['gateway-relay'],
        brains: ['agent-consult'],
        inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 }],
        outputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 }],
        supportsBargeIn: true,
        supportsToolCalls: true,
      }],
    },
  };
}

function sessionResult(inputSampleRateHz = 24_000) {
  return {
    sessionId: 'talk-1',
    provider: 'relay-provider',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    audio: {
      inputEncoding: 'pcm16',
      inputSampleRateHz,
      outputEncoding: 'pcm16',
      outputSampleRateHz: 24_000,
    },
  };
}

function harness(responses: unknown[]) {
  let currentConnectionId = 'connection-a';
  const calls: Array<{
    method: string;
    params: Record<string, unknown>;
    connectionId: string;
    options?: GatewayRequestOptions;
  }> = [];
  const gateway = new TalkGatewayClient({
    isConnectionCurrent: (connectionId) => connectionId === currentConnectionId,
    requestFenced: async (method, params, connectionId, options) => {
      calls.push({ method, params, connectionId, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    subscribe: (_listener: TalkEventListener) => () => undefined,
    subscribeRelay: () => () => undefined,
  });
  return {
    client: gateway.bindConnection(currentConnectionId),
    gateway,
    calls,
    setCurrentConnectionId: (connectionId: string) => { currentConnectionId = connectionId; },
  };
}

test('Talk 客户端只创建目录声明的实时 Gateway 中继', async () => {
  const { client, calls } = harness([catalog(), sessionResult()]);
  const session = await client.createRealtimeRelay('agent:main:main');
  assert.deepEqual(session, {
    sessionId: 'talk-1',
    provider: 'relay-provider',
    inputAudioFormat: { encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 },
    outputAudioFormat: { encoding: 'pcm16', sampleRateHz: 24_000, channels: 1 },
  });
  assert.deepEqual(calls.map((call) => call.method), ['talk.catalog', 'talk.session.create']);
  assert.deepEqual(calls[1]?.params, {
    sessionKey: 'agent:main:main',
    provider: 'relay-provider',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
  });
});

test('Talk 客户端拒绝未就绪目录和与实际响应不一致的格式', async () => {
  const unready = catalog();
  unready.realtime.ready = false;
  const unavailable = harness([unready]).client;
  await assert.rejects(unavailable.createRealtimeRelay('agent:main:main'), TalkGatewayUnavailableError);

  const mismatched = harness([catalog(), sessionResult(16_000)]).client;
  await assert.rejects(mismatched.createRealtimeRelay('agent:main:main'), TalkGatewayUnavailableError);
});

test('Talk 客户端分别使用官方输出中断和轮次停止方法', async () => {
  const { client, calls } = harness([{}, {}, {}, {}]);
  await client.cancelOutput('talk-1', 'turn-1');
  await client.cancelOutput('talk-1', 'turn-2', 'playback-overflow');
  await client.cancelTurn('talk-1', 'turn-1');
  await client.acknowledgeMark('talk-1', 'mark-1');
  assert.deepEqual(calls.map(({ options: _options, ...call }) => call), [
    {
      method: 'talk.session.cancelOutput',
      params: { sessionId: 'talk-1', turnId: 'turn-1', reason: 'barge-in' },
      connectionId: 'connection-a',
    },
    {
      method: 'talk.session.cancelOutput',
      params: { sessionId: 'talk-1', turnId: 'turn-2', reason: 'playback-overflow' },
      connectionId: 'connection-a',
    },
    {
      method: 'talk.session.cancelTurn',
      params: { sessionId: 'talk-1', turnId: 'turn-1', reason: 'user-stop' },
      connectionId: 'connection-a',
    },
    {
      method: 'talk.session.acknowledgeMark',
      params: { sessionId: 'talk-1', markName: 'mark-1' },
      connectionId: 'connection-a',
    },
  ]);
});

test('Talk 音频追加绑定会话取消信号并使用有限等待时间', async () => {
  const { client, calls } = harness([{}]);
  const controller = new AbortController();
  await client.appendAudio('talk-1', 'AA==', 1_234, controller.signal);

  assert.equal(calls[0]?.options?.signal, controller.signal);
  assert.equal(typeof calls[0]?.options?.timeoutMs, 'number');
  assert.ok((calls[0]?.options?.timeoutMs ?? 0) > 0);
});

test('Talk 工具调用只使用官方中继方法并按精确 runId 等待和中止', async () => {
  const { client, calls } = harness([
    { runId: 'run-1', idempotencyKey: 'idem-1' },
    {
      runId: 'run-1',
      status: 'ok',
      terminalReply: { disposition: 'visible', text: '最终结果' },
    },
    { ok: true, mode: 'status' },
    { ok: true },
    { ok: true },
  ]);
  const started = await client.startAgentConsult(
    'agent:main:main',
    'talk-1',
    'call-1',
    { question: '检查状态' },
  );
  assert.deepEqual(started, { runId: 'run-1', idempotencyKey: 'idem-1' });
  assert.equal(await client.waitForAgentConsult('run-1'), '最终结果');
  await client.steerAgent('talk-1', 'agent:main:main', { text: '报告状态', mode: 'status' });
  await client.submitToolResult('talk-1', 'call-1', { result: '最终结果' });
  await client.abortAgentConsult('agent:main:main', 'run-1');

  assert.deepEqual(calls.map((call) => call.method), [
    'talk.client.toolCall',
    'agent.wait',
    'talk.session.steer',
    'talk.session.submitToolResult',
    'chat.abort',
  ]);
  assert.deepEqual(calls[0]?.params, {
    sessionKey: 'agent:main:main',
    voiceSessionId: 'talk-1',
    callId: 'call-1',
    name: 'openclaw_agent_consult',
    args: { question: '检查状态' },
    relaySessionId: 'talk-1',
  });
  assert.deepEqual(calls[1]?.params, { runId: 'run-1', timeoutMs: 120_000 });
  assert.deepEqual(calls[4]?.params, { sessionKey: 'agent:main:main', runId: 'run-1' });
});

test('Talk 工具等待拒绝错配 runId 和畸形终态', async () => {
  const mismatched = harness([{ runId: 'run-other', status: 'ok' }]).client;
  await assert.rejects(mismatched.waitForAgentConsult('run-1'), TalkGatewayUnavailableError);

  const malformed = harness([{
    runId: 'run-1',
    status: 'ok',
    terminalReply: { disposition: 'visible' },
  }]).client;
  await assert.rejects(malformed.waitForAgentConsult('run-1'), TalkGatewayUnavailableError);
});

test('Talk 连接租约失效后拒绝把旧会话请求发送到新连接', async () => {
  const harnessed = harness([{}]);
  harnessed.setCurrentConnectionId('connection-b');

  await assert.rejects(
    harnessed.client.abortAgentConsult('agent:main:main', 'run-1'),
    TalkGatewayUnavailableError,
  );
  assert.equal(harnessed.calls.length, 0);

  const current = harnessed.gateway.bindConnection('connection-b');
  await current.abortAgentConsult('agent:main:main', 'run-2');
  assert.deepEqual(harnessed.calls.map((call) => call.connectionId), ['connection-b']);
});
