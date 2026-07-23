import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openClawMediaPath,
  resolveOpenClawMediaPreviewUrl,
} from './openclawMediaPreview';

test('extracts only explicit OpenClaw transcript media sources', () => {
  assert.equal(openClawMediaPath('aegis-media:/Users/test/.openclaw/media/inbound/screenshot.png'), '/Users/test/.openclaw/media/inbound/screenshot.png');
  assert.equal(openClawMediaPath('https://gateway.invalid/media/screenshot.png'), null);
  assert.equal(openClawMediaPath('aegis-media:   '), null);
});

test('uses the scoped native preview bridge for persisted OpenClaw media', async () => {
  const requested: string[] = [];
  const url = await resolveOpenClawMediaPreviewUrl(
    'aegis-media:/Users/test/.openclaw/media/inbound/screenshot.png',
    {
      openclawMedia: {
        createPreview: async (path) => {
          requested.push(path);
          return { success: true, url: 'junqi-preview://localhost/token/screenshot.png' };
        },
      },
    },
  );

  assert.deepEqual(requested, ['/Users/test/.openclaw/media/inbound/screenshot.png']);
  assert.equal(url, 'junqi-preview://localhost/token/screenshot.png');
});

test('does not turn an unavailable native preview into a filesystem fallback', async () => {
  const url = await resolveOpenClawMediaPreviewUrl('aegis-media:/Users/test/.openclaw/media/inbound/missing.png', {
    openclawMedia: {
      createPreview: async () => ({ success: false, error: 'not available' }),
    },
  });
  assert.equal(url, null);
});
