import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeVoiceTalkPlaybackAppendResult } from './voiceTalkPlaybackContract';

test('Talk 原生播放响应明确区分已排队与背压拒绝', () => {
  assert.deepEqual(decodeVoiceTalkPlaybackAppendResult({ queued: true }), { queued: true });
  assert.deepEqual(decodeVoiceTalkPlaybackAppendResult({ queued: false }), { queued: false });
  assert.equal(decodeVoiceTalkPlaybackAppendResult({ queued: 'yes' }), null);
  assert.equal(decodeVoiceTalkPlaybackAppendResult(null), null);
});
