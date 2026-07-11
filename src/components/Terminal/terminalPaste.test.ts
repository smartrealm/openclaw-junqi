import assert from 'node:assert/strict';
import test from 'node:test';
import { pasteAndSubmit } from './terminalPaste';

test('pasteAndSubmit queues enter after the xterm paste dispatch', async () => {
  const events: string[] = [];
  assert.equal(pasteAndSubmit((text) => events.push(`paste:${text}`), (text) => events.push(`send:${text}`), 'echo hello'), true);
  assert.deepEqual(events, ['paste:echo hello']);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.deepEqual(events, ['paste:echo hello', 'send:\r']);
});

test('pasteAndSubmit leaves empty text untouched', () => {
  assert.equal(pasteAndSubmit(() => assert.fail('should not paste'), () => assert.fail('should not send'), ''), false);
});
