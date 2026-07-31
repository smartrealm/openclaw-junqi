import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isVoiceInputCapturePhase } from '@/services/voice/VoiceModeCoordinator';

const emitter = readFileSync(new URL('./usePetStateEmitter.ts', import.meta.url), 'utf8');

test('pet maps only active voice capture phases into its existing non-text thinking cue', () => {
  assert.equal(isVoiceInputCapturePhase('listening'), true);
  assert.equal(isVoiceInputCapturePhase('triggered'), true);
  assert.equal(isVoiceInputCapturePhase('transcribing'), true);
  assert.equal(isVoiceInputCapturePhase('ready_to_send'), false);
  assert.equal(isVoiceInputCapturePhase('unavailable'), false);
  assert.match(emitter, /voiceModeCoordinator\.getSnapshot\(\)/);
  assert.match(emitter, /voiceModeCoordinator\.subscribe\(wake\)/);
  assert.doesNotMatch(emitter, /voiceMode\.draft/);
});
