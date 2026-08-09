import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_AUTO_PLAY_STORAGE_KEY,
  syncVoiceSettingFromStorage,
  VOICE_AUTO_SPEAK_STORAGE_KEY,
  useSettingsStore,
} from '@/stores/settingsStore';
import { useVoiceStore, VOICE_IDLE_SNAPSHOT } from '@/stores/voiceStore';
import { VoiceRuntime } from './VoiceRuntime';
import type { VoiceSpeechOutput } from '@/services/voice/GatewayTtsSpeechOutput';
import type { VoiceGlobalControl } from '@/types/voice';

interface MockVoiceOutput extends VoiceSpeechOutput {
  readonly spoken: string[];
  readonly aborted: string[];
  readonly stopped: { count: number };
}

function createVoiceOutput(options: { autoFinish?: boolean; failure?: Error } = {}): MockVoiceOutput {
  const spoken: string[] = [];
  const aborted: string[] = [];
  const stopped = { count: 0 };
  let active: { finish: () => void } | null = null;
  return {
    spoken,
    aborted,
    stopped,
    speak: (text, signal) => new Promise<void>((resolve, reject) => {
      spoken.push(text);
      let settled = false;
      const settle = (error?: Error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (active?.finish === finish) active = null;
        if (error) reject(error);
        else resolve();
      };
      const finish = () => settle(options.failure);
      const onAbort = () => {
        aborted.push(text);
        settle();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      active = { finish };
      if (options.autoFinish !== false) queueMicrotask(finish);
    }),
    stop: () => {
      stopped.count += 1;
      active?.finish();
    },
  };
}

function createRuntime(
  output = createVoiceOutput(),
  options: {
    instanceId?: string;
    emitControl?: (control: VoiceGlobalControl) => void;
    subscribeControl?: (handler: (control: VoiceGlobalControl) => void) => () => void;
    stopNativeTalkPlayback?: () => void | Promise<void>;
  } = {},
): VoiceRuntime {
  return new VoiceRuntime({ ...options, speechOutput: output });
}

function setVoiceOutputSettings({ synthetic = false, media = false } = {}) {
  localStorage.setItem(VOICE_AUTO_SPEAK_STORAGE_KEY, String(synthetic));
  localStorage.setItem(AUDIO_AUTO_PLAY_STORAGE_KEY, String(media));
  useSettingsStore.setState({ voiceAutoSpeak: synthetic, audioAutoPlay: media, language: 'zh' });
  useVoiceStore.getState().setRemoteOutput(null);
}

async function settleVoiceQueue(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test('VoiceRuntime requests Gateway TTS for completed sentences while a response streams', async () => {
  const output = createVoiceOutput();
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = createRuntime(output);

  try {
    runtime.consumeStream('agent:main:main', '第一句。', 'run-1');
    runtime.consumeStream('agent:main:main', '第一句。第二句', 'run-1');
    runtime.finishStream('agent:main:main', '第一句。第二句', 'final', 'run-1');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['第一句。', '第二句']);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('scoped interruption aborts only its active Gateway TTS request and preserves another session queue', async () => {
  const output = createVoiceOutput({ autoFinish: false });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = createRuntime(output);

  try {
    runtime.consumeStream('session-a', '甲。', 'run-a');
    runtime.consumeStream('session-b', '乙。', 'run-b');
    runtime.interrupt('session-a');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['甲。', '乙。']);
    assert.deepEqual(output.aborted, ['甲。']);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('streaming sanitizer never sends an unfinished code block to Gateway TTS', async () => {
  const output = createVoiceOutput();
  setVoiceOutputSettings({ synthetic: true });
  const runtime = createRuntime(output);

  try {
    runtime.consumeStream('session-audit', '结论。```ts\nconsole.log("not speech.");', 'run-audit');
    runtime.consumeStream('session-audit', '结论。```ts\nconsole.log("not speech.");\n```后续。', 'run-audit');
    runtime.finishStream('session-audit', '结论。```ts\nconsole.log("not speech.");\n```后续。', 'final', 'run-audit');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['结论。', '后续。']);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('external assistant media is claimed only by a pending live response', () => {
  setVoiceOutputSettings({ media: true });
  const runtime = createRuntime();
  const token = Symbol('test-audio');
  let stopped = false;

  try {
    runtime.speakMessage('session-media', '', 'aegis-media:/tmp/reply.wav');
    assert.equal(runtime.claimExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav'), true);
    assert.equal(runtime.claimExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav'), false);
    runtime.startExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav', token, () => { stopped = true; });
    runtime.interrupt('session-media');
    assert.equal(stopped, true);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('claiming one external player preserves another session request', () => {
  setVoiceOutputSettings({ media: true });
  const runtime = createRuntime();
  const sourceA = 'aegis-media:/tmp/a.wav';
  const sourceB = 'aegis-media:/tmp/b.wav';

  try {
    runtime.speakMessage('session-a', '', sourceA);
    runtime.speakMessage('session-b', '', sourceB);
    assert.equal(runtime.claimExternalPlayback('session-a', sourceA), true);
    runtime.startExternalPlayback('session-a', sourceA, Symbol('audio-a'), () => undefined);
    assert.equal(runtime.claimExternalPlayback('session-b', sourceB), true);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('a new assistant segment flushes the prior unfinished Gateway TTS tail', async () => {
  const output = createVoiceOutput();
  setVoiceOutputSettings({ synthetic: true });
  const runtime = createRuntime(output);

  try {
    runtime.consumeStream('session-segments', '先检查', 'message-1');
    runtime.consumeStream('session-segments', '完成。', 'message-2');
    runtime.finishStream('session-segments', '完成。', 'final', 'message-2');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['先检查', '完成。']);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('external media failure resumes queued Gateway TTS output', async () => {
  const output = createVoiceOutput();
  setVoiceOutputSettings({ synthetic: true });
  const runtime = createRuntime(output);
  const token = Symbol('failed-media');

  try {
    runtime.consumeStream('queued-session', '第一。第二。', 'message-q');
    runtime.startExternalPlayback('media-session', 'aegis-media:/tmp/fail.wav', token, () => undefined);
    runtime.failExternalPlayback('media-session', 'aegis-media:/tmp/fail.wav', token);
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['第一。', '第二。']);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('newer cross-window claim and global stop interrupt other runtimes', () => {
  const handlers = new Set<(control: VoiceGlobalControl) => void>();
  const subscribeControl = (handler: (control: VoiceGlobalControl) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  const emitControl = (control: VoiceGlobalControl) => {
    for (const handler of handlers) handler(control);
  };
  const main = createRuntime(createVoiceOutput(), { instanceId: 'main', emitControl, subscribeControl });
  const quick = createRuntime(createVoiceOutput(), { instanceId: 'quick', emitControl, subscribeControl });
  let mainStopped = false;
  let quickStopped = false;

  try {
    setVoiceOutputSettings({ media: true });
    main.startExternalPlayback('agent:main:main', 'main.wav', Symbol('main'), () => { mainStopped = true; });
    quick.startExternalPlayback('quickchat:1', 'quick.wav', Symbol('quick'), () => { quickStopped = true; });
    assert.equal(mainStopped, true);
    assert.equal(quickStopped, false);
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'quickchat:1');
    main.interruptAll();
    assert.equal(quickStopped, true);
  } finally {
    main.dispose();
    quick.dispose();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('Talk PCM output claims the desktop-wide voice slot and is preempted by a newer window claim', () => {
  const handlers = new Set<(control: VoiceGlobalControl) => void>();
  const subscribeControl = (handler: (control: VoiceGlobalControl) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  const emitControl = (control: VoiceGlobalControl) => {
    for (const handler of handlers) handler(control);
  };
  let stoppedNativeTalk = 0;
  const talk = createRuntime(createVoiceOutput(), {
    instanceId: 'talk', emitControl, subscribeControl,
    stopNativeTalkPlayback: () => { stoppedNativeTalk += 1; },
  });
  const other = createRuntime(createVoiceOutput(), { instanceId: 'other', emitControl, subscribeControl });

  try {
    talk.setNativeTalkOutput('agent:talk:main', true);
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'agent:talk:main');
    other.startExternalPlayback('agent:main:main', 'reply.wav', Symbol('reply'), () => undefined);
    assert.equal(stoppedNativeTalk, 1);
  } finally {
    talk.dispose();
    other.dispose();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    useVoiceStore.getState().setRemoteOutput(null);
  }
});

test('stopping Talk output releases its claim when no replacement output starts', () => {
  const controls: VoiceGlobalControl[] = [];
  const runtime = createRuntime(createVoiceOutput(), {
    instanceId: 'talk',
    emitControl: (control) => { controls.push(control); },
    stopNativeTalkPlayback: () => undefined,
  });

  try {
    runtime.setNativeTalkOutput('agent:talk:main', true);
    runtime.interrupt('agent:talk:main');
    assert.deepEqual(controls.map((control) => control.type), ['claim', 'release']);
  } finally {
    runtime.dispose();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('legacy live-media preference does not enable Gateway TTS', async () => {
  const output = createVoiceOutput();
  setVoiceOutputSettings({ media: true, synthetic: false });
  const runtime = createRuntime(output);

  try {
    runtime.finishStream('legacy-setting', '不应朗读。', 'final', 'message-legacy');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, []);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('Stop aborts the local Gateway TTS wait without a local speech fallback', async () => {
  const output = createVoiceOutput({ autoFinish: false });
  setVoiceOutputSettings({ synthetic: true });
  const runtime = createRuntime(output);

  try {
    runtime.finishStream('session-stop', '停止前的回复。', 'final', 'run-stop');
    await settleVoiceQueue();
    runtime.interrupt('session-stop');
    await settleVoiceQueue();
    assert.deepEqual(output.spoken, ['停止前的回复。']);
    assert.deepEqual(output.aborted, ['停止前的回复。']);
    assert.equal(output.stopped.count > 0, true);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('Gateway TTS failures enter the existing voice error projection', async () => {
  const output = createVoiceOutput({ failure: new Error('OpenClaw TTS unavailable') });
  setVoiceOutputSettings({ synthetic: true });
  const runtime = createRuntime(output);

  try {
    runtime.finishStream('session-error', '失败回复。', 'final', 'run-error');
    await settleVoiceQueue();
    assert.equal(useVoiceStore.getState().phase, 'error');
    assert.equal(useVoiceStore.getState().lastError, 'OpenClaw TTS unavailable');
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
  }
});

test('storage changes synchronize independent WebView settings stores', () => {
  setVoiceOutputSettings();
  syncVoiceSettingFromStorage(AUDIO_AUTO_PLAY_STORAGE_KEY, 'true');
  assert.equal(useSettingsStore.getState().audioAutoPlay, true);
  assert.equal(useSettingsStore.getState().voiceAutoSpeak, false);
  syncVoiceSettingFromStorage(VOICE_AUTO_SPEAK_STORAGE_KEY, 'true');
  assert.equal(useSettingsStore.getState().voiceAutoSpeak, true);
  syncVoiceSettingFromStorage(VOICE_AUTO_SPEAK_STORAGE_KEY, null);
  assert.equal(useSettingsStore.getState().voiceAutoSpeak, false);
  setVoiceOutputSettings();
});

test('reordered release and stop controls tombstone stale claims', () => {
  const subscription: { receive?: (control: VoiceGlobalControl) => void } = {};
  const runtime = createRuntime(createVoiceOutput(), {
    instanceId: 'observer',
    emitControl: () => undefined,
    subscribeControl: (handler) => {
      subscription.receive = handler;
      return () => { subscription.receive = undefined; };
    },
  });
  const staleClaim = { claimedAt: 100, sequence: 1, instanceId: 'quick', sessionKey: 'quickchat:stale' };
  const newerReleasedClaim = { claimedAt: 200, sequence: 2, instanceId: 'main', sessionKey: 'agent:main:main' };
  const stopClaim = { claimedAt: 300, sequence: 3, instanceId: 'quick', sessionKey: '' };

  try {
    const receive = subscription.receive;
    assert.ok(receive);
    receive({ type: 'claim', claim: staleClaim });
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'quickchat:stale');
    receive({ type: 'release', claim: newerReleasedClaim });
    receive({ type: 'claim', claim: newerReleasedClaim });
    assert.equal(useVoiceStore.getState().remoteOutput, null);
    receive({ type: 'stop', claim: stopClaim });
    receive({ type: 'claim', claim: newerReleasedClaim });
    assert.equal(useVoiceStore.getState().remoteOutput, null);
  } finally {
    runtime.dispose();
    useVoiceStore.getState().setRemoteOutput(null);
  }
});
