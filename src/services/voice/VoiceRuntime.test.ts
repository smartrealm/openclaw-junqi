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
import type { VoiceGlobalControl } from './types';

class MockSpeechSynthesisUtterance {
  lang = '';
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;

  constructor(readonly text: string) {}
}

function setVoiceOutputSettings({ synthetic = false, media = false } = {}) {
  localStorage.setItem(VOICE_AUTO_SPEAK_STORAGE_KEY, String(synthetic));
  localStorage.setItem(AUDIO_AUTO_PLAY_STORAGE_KEY, String(media));
  useSettingsStore.setState({ voiceAutoSpeak: synthetic, audioAutoPlay: media, language: 'zh' });
  useVoiceStore.getState().setRemoteOutput(null);
}

test('VoiceRuntime speaks completed sentences while a response is still streaming', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      cancel: () => undefined,
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        spoken.push(utterance.text);
        queueMicrotask(() => utterance.onend?.());
      },
    },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();

  try {
    runtime.consumeStream('agent:main:main', '第一句。', 'run-1');
    runtime.consumeStream('agent:main:main', '第一句。第二句', 'run-1');
    runtime.finishStream('agent:main:main', '第一句。第二句', 'final', 'run-1');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(spoken, ['第一句。', '第二句']);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-04 scoped interruption preserves another session queue', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  let active: MockSpeechSynthesisUtterance | null = null;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      cancel: () => { active?.onerror?.({ error: 'canceled' }); },
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        active = utterance;
        spoken.push(utterance.text);
      },
    },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();

  try {
    runtime.consumeStream('session-a', '甲。', 'run-a');
    runtime.consumeStream('session-b', '乙。', 'run-b');
    runtime.interrupt('session-a');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(spoken, ['甲。', '乙。']);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-05 streaming sanitizer never speaks an unfinished code block', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      cancel: () => undefined,
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        spoken.push(utterance.text);
        queueMicrotask(() => utterance.onend?.());
      },
    },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();

  try {
    runtime.consumeStream('session-audit', '结论。```ts\nconsole.log("not speech.");', 'run-audit');
    runtime.consumeStream('session-audit', '结论。```ts\nconsole.log("not speech.");\n```后续。', 'run-audit');
    runtime.finishStream('session-audit', '结论。```ts\nconsole.log("not speech.");\n```后续。', 'final', 'run-audit');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(spoken, ['结论。', '后续。']);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-06 external media is claimed only by a pending live response', () => {
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  setVoiceOutputSettings({ media: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();
  const token = Symbol('test-audio');
  let stopped = false;

  try {
    runtime.speakMessage('session-media', '', 'aegis-media:/tmp/reply.wav');
    assert.equal(runtime.claimExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav'), true);
    assert.equal(runtime.claimExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav'), false);
    runtime.startExternalPlayback('session-media', 'aegis-media:/tmp/reply.wav', token, () => { stopped = true; });
    assert.equal(useVoiceStore.getState().phase, 'speaking');
    runtime.interrupt('session-media');
    assert.equal(stopped, true);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-11 claiming one external player preserves another session request', () => {
  setVoiceOutputSettings({ media: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();
  const sourceA = 'aegis-media:/tmp/a.wav';
  const sourceB = 'aegis-media:/tmp/b.wav';
  const tokenA = Symbol('audio-a');

  try {
    runtime.speakMessage('session-a', '', sourceA);
    runtime.speakMessage('session-b', '', sourceB);
    assert.equal(runtime.claimExternalPlayback('session-a', sourceA), true);
    runtime.startExternalPlayback('session-a', sourceA, tokenA, () => undefined);
    assert.equal(runtime.claimExternalPlayback('session-b', sourceB), true);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('BUG-17 a new assistant segment flushes the prior unfinished tail', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      cancel: () => undefined,
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        spoken.push(utterance.text);
        queueMicrotask(() => utterance.onend?.());
      },
    },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();

  try {
    runtime.consumeStream('session-segments', '先检查', 'message-1');
    runtime.consumeStream('session-segments', '完成。', 'message-2');
    runtime.finishStream('session-segments', '完成。', 'final', 'message-2');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(spoken, ['先检查', '完成。']);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-11 external media failure resumes queued synthetic speech', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: {
      cancel: () => undefined,
      speak: (utterance: MockSpeechSynthesisUtterance) => {
        spoken.push(utterance.text);
      },
    },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ synthetic: true });
  useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  const runtime = new VoiceRuntime();
  const token = Symbol('failed-media');

  try {
    runtime.consumeStream('queued-session', '第一。第二。', 'message-q');
    runtime.startExternalPlayback('media-session', 'aegis-media:/tmp/fail.wav', token, () => undefined);
    runtime.failExternalPlayback('media-session', 'aegis-media:/tmp/fail.wav', token);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(spoken, ['第一。', '第二。']);
  } finally {
    runtime.interruptAll();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-18 newer cross-window claim and global stop interrupt other runtimes', () => {
  const handlers = new Set<(control: VoiceGlobalControl) => void>();
  const subscribeControl = (handler: (control: VoiceGlobalControl) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  const emitControl = (control: VoiceGlobalControl) => {
    for (const handler of handlers) handler(control);
  };
  const main = new VoiceRuntime({ instanceId: 'main', emitControl, subscribeControl });
  const quick = new VoiceRuntime({ instanceId: 'quick', emitControl, subscribeControl });
  const mainToken = Symbol('main');
  const quickToken = Symbol('quick');
  let mainStopped = false;
  let quickStopped = false;

  try {
    setVoiceOutputSettings({ media: true });
    main.startExternalPlayback('agent:main:main', 'main.wav', mainToken, () => { mainStopped = true; });
    quick.startExternalPlayback('quickchat:1', 'quick.wav', quickToken, () => { quickStopped = true; });
    assert.equal(mainStopped, true);
    assert.equal(quickStopped, false);
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'quickchat:1');

    main.interruptAll();
    assert.equal(quickStopped, true);
    assert.equal(useVoiceStore.getState().remoteOutput, null);

    const quickToken2 = Symbol('quick-2');
    quick.startExternalPlayback('quickchat:2', 'quick-2.wav', quickToken2, () => undefined);
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'quickchat:2');
    quick.endExternalPlayback(quickToken2);
    assert.equal(useVoiceStore.getState().remoteOutput, null);
  } finally {
    main.dispose();
    quick.dispose();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('BUG-19 legacy media preference does not enable synthetic speech', async () => {
  const spoken: string[] = [];
  const originalUtterance = globalThis.SpeechSynthesisUtterance;
  const originalSynthesis = window.speechSynthesis;
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: MockSpeechSynthesisUtterance,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, 'speechSynthesis', {
    value: { cancel: () => undefined, speak: (utterance: MockSpeechSynthesisUtterance) => spoken.push(utterance.text) },
    configurable: true,
    writable: true,
  });
  setVoiceOutputSettings({ media: true, synthetic: false });
  const runtime = new VoiceRuntime();

  try {
    runtime.finishStream('legacy-setting', '不应朗读。', 'final', 'message-legacy');
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(spoken, []);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
      value: originalUtterance,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'speechSynthesis', {
      value: originalSynthesis,
      configurable: true,
      writable: true,
    });
  }
});

test('BUG-19 storage changes synchronize independent WebView settings stores', () => {
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

test('BUG-23 reordered release and stop controls tombstone stale claims', () => {
  let receive: ((control: VoiceGlobalControl) => void) | null = null;
  const runtime = new VoiceRuntime({
    instanceId: 'observer',
    emitControl: () => undefined,
    subscribeControl: (handler) => {
      receive = handler;
      return () => { receive = null; };
    },
  });
  const deliver = (control: VoiceGlobalControl) => {
    assert.ok(receive, 'global control subscriber was not installed');
    receive(control);
  };
  const staleClaim = {
    claimedAt: 100,
    sequence: 1,
    instanceId: 'quick',
    sessionKey: 'quickchat:stale',
  };
  const newerReleasedClaim = {
    claimedAt: 200,
    sequence: 2,
    instanceId: 'main',
    sessionKey: 'agent:main:main',
  };
  const stopClaim = {
    claimedAt: 300,
    sequence: 3,
    instanceId: 'quick',
    sessionKey: '',
  };

  try {
    deliver({ type: 'claim', claim: staleClaim });
    assert.equal(useVoiceStore.getState().remoteOutput?.sessionKey, 'quickchat:stale');

    deliver({ type: 'release', claim: newerReleasedClaim });
    deliver({ type: 'claim', claim: newerReleasedClaim });
    assert.equal(useVoiceStore.getState().remoteOutput, null);

    deliver({ type: 'stop', claim: stopClaim });
    deliver({ type: 'claim', claim: newerReleasedClaim });
    assert.equal(useVoiceStore.getState().remoteOutput, null);
  } finally {
    runtime.dispose();
    useVoiceStore.getState().setRemoteOutput(null);
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});

test('BUG-23 local runtime cleanup releases ownership without stopping other windows', () => {
  const controls: VoiceGlobalControl[] = [];
  const runtime = new VoiceRuntime({
    instanceId: 'quick',
    emitControl: (control) => { controls.push(control); },
    subscribeControl: () => () => undefined,
  });

  try {
    setVoiceOutputSettings({ media: true });
    runtime.startExternalPlayback('quickchat:local', 'quick-local.wav', Symbol('quick-local'), () => undefined);
    runtime.interruptAll({ broadcast: false });
    assert.deepEqual(controls.map((control) => control.type), ['claim', 'release']);

    const remoteClaim = {
      claimedAt: 400,
      sequence: 4,
      instanceId: 'main',
      sessionKey: 'agent:main:main',
    };
    useVoiceStore.getState().setRemoteOutput(remoteClaim);
    runtime.interruptAll({ broadcast: false, preserveRemote: true });
    assert.equal(useVoiceStore.getState().remoteOutput, remoteClaim);
  } finally {
    runtime.dispose();
    setVoiceOutputSettings();
    useVoiceStore.getState().setSnapshot(VOICE_IDLE_SNAPSHOT);
  }
});
