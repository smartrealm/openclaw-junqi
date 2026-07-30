import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = (path: string) => readFileSync(path, 'utf8');

test('active execution plan is projected above the composer instead of the assistant column', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  const placement = view.indexOf('data-execution-plan-placement="composer-above"');
  const input = view.indexOf('<MessageInput />');
  assert.ok(placement >= 0);
  assert.ok(input > placement);
  assert.match(view, /if \(block\.plan\.state !== 'completed'\) return null/);
});

test('execution plan, dispatch queue, and send composer share the centered send column', () => {
  const view = source('src/components/Chat/ChatView.tsx');
  const input = source('src/components/Chat/MessageInput.tsx');
  const queue = source('src/components/Chat/message-input/MessageQueuePanel.tsx');
  const composer = source('src/components/Chat/message-input/ComposerInputSurface.tsx');
  assert.match(view, /data-execution-plan-placement="composer-above"[\s\S]*?mx-auto w-full max-w-\[760px\]/);
  assert.match(input, /<MessageQueuePanel[\s\S]*?<ComposerInputSurface/);
  assert.match(queue, /data-message-queue-placement="composer-above"[\s\S]*?mx-auto w-full max-w-\[760px\]/);
  assert.match(composer, /mx-auto flex w-full max-w-\[784px\]/);
});
