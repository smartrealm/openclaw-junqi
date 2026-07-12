import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePetRenderMode } from './petRenderMode';

test('built-in pet prefers the real 3D renderer when WebGL is available', () => {
  assert.equal(resolvePetRenderMode({ webglAvailable: true }), 'three');
});

test('custom animation packages retain the sprite renderer even when WebGL is available', () => {
  assert.equal(resolvePetRenderMode({
    webglAvailable: true,
    customPet: {
      id: 'package',
      displayName: 'Package pet',
      description: '',
      spriteVersionNumber: 2,
      spritesheetDataUrl: 'data:image/png;base64,AA==',
    },
  }), 'sprite');
});

test('uploaded single-image pets and WebGL failures fall back to the SVG path', () => {
  assert.equal(resolvePetRenderMode({ webglAvailable: true, customAsset: 'asset://pet.png' }), 'svg');
  assert.equal(resolvePetRenderMode({ webglAvailable: false }), 'svg');
});
