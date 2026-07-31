import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionChannelPresentation } from './sessionChannelPresentation';

test('prefers the structured current channel over historical and origin fields', () => {
  assert.deepEqual(resolveSessionChannelPresentation({
    channel: 'runtime-current',
    lastChannel: 'runtime-previous',
    origin: { provider: 'runtime-origin' },
  }), {
    id: 'runtime-current',
    source: 'channel',
    icon: 'generic',
    label: 'Runtime Current',
  });
});

test('uses lastChannel and origin only when the current channel is unavailable', () => {
  assert.deepEqual(resolveSessionChannelPresentation({
    channel: null,
    lastChannel: 'runtime-plugin',
    origin: { provider: 'runtime-origin' },
  }), {
    id: 'runtime-plugin',
    source: 'lastChannel',
    icon: 'generic',
    label: 'Runtime Plugin',
  });

  assert.deepEqual(resolveSessionChannelPresentation({
    origin: { provider: 'runtime-origin' },
  }), {
    id: 'runtime-origin',
    source: 'originProvider',
    icon: 'generic',
    label: 'Runtime Origin',
  });
});

test('preserves unknown installed channels without impersonating a known product', () => {
  assert.deepEqual(resolveSessionChannelPresentation({ channel: 'acme-chat_bridge' }), {
    id: 'acme-chat_bridge',
    source: 'channel',
    icon: 'generic',
    label: 'Acme Chat Bridge',
  });
});

test('does not derive a channel from a session key, label, or missing metadata', () => {
  assert.equal(resolveSessionChannelPresentation({
    channel: null,
    lastChannel: null,
    origin: { label: 'Telegram support' },
  }), null);
});
