import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readGatewayMessageIdentity,
} from './messageIdentity';

test('reads the canonical OpenClaw history id before legacy top-level aliases', () => {
  assert.deepEqual(readGatewayMessageIdentity({
    id: 'legacy-id',
    messageId: 'legacy-message-id',
    idempotencyKey: 'client-command-1',
    __openclaw: { id: 'native-message-1' },
  }), {
    nativeMessageId: 'native-message-1',
    clientMessageId: 'client-command-1',
  });
});

test('falls back to legacy ids and rejects malformed identity values', () => {
  assert.deepEqual(readGatewayMessageIdentity({ messageId: 'legacy-message-1' }), {
    nativeMessageId: 'legacy-message-1',
  });
  assert.deepEqual(readGatewayMessageIdentity({
    id: ' ',
    messageId: 'bad\nvalue',
    __openclaw: { id: 'x'.repeat(513) },
  }), {});
  assert.deepEqual(readGatewayMessageIdentity(null), {});
});

test('normalizes OpenClaw persisted user and assistant run identities', () => {
  assert.deepEqual(readGatewayMessageIdentity({
    role: 'user',
    idempotencyKey: 'junqi-command-1:user',
    __openclaw: { id: 'native-user-1' },
  }), {
    nativeMessageId: 'native-user-1',
    clientMessageId: 'junqi-command-1',
  });
  assert.equal(
    readGatewayMessageIdentity({ role: 'assistant', idempotencyKey: 'run-2:assistant' }).clientMessageId,
    'run-2',
  );
  assert.equal(
    readGatewayMessageIdentity({ role: 'assistant', idempotencyKey: 'cli-assistant:run-3' }).clientMessageId,
    'run-3',
  );
  assert.equal(
    readGatewayMessageIdentity({ role: 'assistant', idempotencyKey: 'run-4:assistant-media' }).clientMessageId,
    'run-4:assistant-media',
  );
});
