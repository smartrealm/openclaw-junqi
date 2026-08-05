import assert from 'node:assert/strict';
import test from 'node:test';
import { isVoiceInputCapturePhase } from '@/services/voice/VoiceModeCoordinator';

test('萌宠只把 Talk 的采集和等待阶段映射为非文本思考提示', () => {
  assert.equal(isVoiceInputCapturePhase('preparing'), false);
  assert.equal(isVoiceInputCapturePhase('listening'), true);
  assert.equal(isVoiceInputCapturePhase('hearing'), true);
  assert.equal(isVoiceInputCapturePhase('thinking'), true);
  assert.equal(isVoiceInputCapturePhase('speaking'), false);
  assert.equal(isVoiceInputCapturePhase('error'), false);
});
