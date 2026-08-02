import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chatNotificationDedupeKey,
  gatewayChatNotificationDedupeKey,
} from './notificationIdentity';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('chat notification identity is stable across live and durable Gateway paths', () => {
  const live = gatewayChatNotificationDedupeKey({
    sessionKey: 'agent:legal:main',
    role: 'assistant',
    runId: 'run-42',
    nativeMessageId: 'live-message',
  });
  const durable = gatewayChatNotificationDedupeKey({
    sessionKey: 'agent:legal:main',
    role: 'assistant',
    runId: 'run-42',
    clientMessageId: 'different-client-message',
    nativeMessageId: 'different-native-message',
    messageSeq: 42,
  });
  assert.equal(live, 'chat:assistant:agent:legal:main:run-42');
  assert.equal(durable, live);
});

test('chat notification identity rejects incomplete Gateway identities', () => {
  assert.equal(chatNotificationDedupeKey('agent:legal:main', 'assistant', undefined), undefined);
  assert.equal(chatNotificationDedupeKey('', 'assistant', 'run-42'), undefined);
});

test('chat notification identity uses durable message fields only when no run id exists', () => {
  assert.equal(
    gatewayChatNotificationDedupeKey({
      sessionKey: 'agent:legal:main',
      role: 'assistant',
      clientMessageId: 'client-message',
      nativeMessageId: 'native-message',
      messageSeq: 7,
    }),
    'chat:assistant:agent:legal:main:client-message',
  );
});

test('the app routes chat notification candidates through the source-aware projection', () => {
  assert.match(appSource, /projectChatNotification\(\{[\s\S]*?source: 'stream-final'/);
  assert.match(appSource, /projectChatNotification\(\{[\s\S]*?source: 'transcript'/);
  assert.doesNotMatch(appSource, /source: 'legacy-message'/);
});
