import assert from 'node:assert/strict';
import test from 'node:test';
import { chatNotificationDedupeKey } from './notificationIdentity';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

test('chat notification identity is derived only from the native OpenClaw run id', () => {
  assert.equal(
    chatNotificationDedupeKey('agent:legal:main', 'assistant', 'run-42'),
    'chat:assistant:agent:legal:main:run-42',
  );
});

test('chat notification identity rejects incomplete Gateway identities', () => {
  assert.equal(chatNotificationDedupeKey('agent:legal:main', 'assistant', undefined), undefined);
  assert.equal(chatNotificationDedupeKey('', 'assistant', 'run-42'), undefined);
});

test('the app routes only native stream-final events into chat notification projection', () => {
  assert.match(appSource, /projectChatNotification\(\{[\s\S]*?runId: meta\?\.runId/);
  assert.doesNotMatch(appSource, /onTranscriptMessage:[\s\S]*?projectChatNotification/);
});
