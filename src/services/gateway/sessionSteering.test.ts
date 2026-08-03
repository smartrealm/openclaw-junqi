import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionsSteerParams } from './sessionSteering';

test('builds the official sessions.steer envelope and omits unsupported empty fields', () => {
  assert.deepEqual(buildSessionsSteerParams(' agent:main:main ', '  continue with the smaller patch  ', {
    agentId: ' ',
    thinking: ' high ',
    attachments: [{ type: 'file' }],
    timeoutMs: 1500.9,
    idempotencyKey: ' steer-1 ',
  }), {
    key: 'agent:main:main',
    message: 'continue with the smaller patch',
    thinking: 'high',
    attachments: [{ type: 'file' }],
    timeoutMs: 1500,
    idempotencyKey: 'steer-1',
  });
});

test('rejects missing session keys, messages, and invalid timeout values', () => {
  assert.throws(() => buildSessionsSteerParams(' ', 'message'), /session key/);
  assert.throws(() => buildSessionsSteerParams('agent:main:main', ' '), /message/);
  assert.throws(() => buildSessionsSteerParams('agent:main:main', 'message', { timeoutMs: -1 }), /timeoutMs/);
  assert.throws(() => buildSessionsSteerParams('agent:main:main', 'message', { timeoutMs: Number.NaN }), /timeoutMs/);
});
