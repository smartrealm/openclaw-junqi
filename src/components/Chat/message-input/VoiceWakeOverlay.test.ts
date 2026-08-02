import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowVoiceWakeOverlay } from './VoiceWakeOverlay';

const base = {
  revision: 1,
  turnId: 'voice-turn-1',
  context: { sessionKey: 'agent:main:main', connectionId: 'connection-1' },
  draft: null,
  error: null,
} as const;

test('Wake mode uses the main-window overlay for every non-off voice state', () => {
  assert.equal(shouldShowVoiceWakeOverlay({ ...base, mode: 'wake_word', phase: 'listening' }), true);
  assert.equal(shouldShowVoiceWakeOverlay({ ...base, mode: 'wake_word', phase: 'ready_to_send' }), true);
  assert.equal(shouldShowVoiceWakeOverlay({ ...base, mode: 'dictation', phase: 'listening' }), false);
  assert.equal(shouldShowVoiceWakeOverlay({ ...base, mode: 'off', phase: 'off' }), false);
});
