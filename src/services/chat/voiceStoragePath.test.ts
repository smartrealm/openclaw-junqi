import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToBase64, voiceSessionDirectory } from './voiceStoragePath';

test('语音数据使用分块编码并支持较大的音频缓冲区', () => {
  const bytes = Uint8Array.from({ length: 180_000 }, (_, index) => index % 251);
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

test('语音目录把不可信会话键限制在应用目录内且避免截断碰撞', () => {
  const hostilePath = voiceSessionDirectory('/app/data/', 'agent:main/../../main');
  const formerlyCollidingPath = voiceSessionDirectory('/app/data/', 'agent_main_______main');
  assert.match(hostilePath, /^\/app\/data\/voice\/v1\/[a-zA-Z0-9_\/-]+\/_$/);
  assert.equal(hostilePath.includes('..'), false);
  assert.notEqual(hostilePath, formerlyCollidingPath);

  const exactChunkPath = voiceSessionDirectory('/app/data/', 'a'.repeat(90));
  const extendedPath = voiceSessionDirectory('/app/data/', `${'a'.repeat(90)}b`);
  assert.equal(extendedPath.startsWith(`${exactChunkPath}/`), false);
});
