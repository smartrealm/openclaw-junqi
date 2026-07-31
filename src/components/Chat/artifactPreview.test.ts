import assert from 'node:assert/strict';
import test from 'node:test';
import { isPreviewableArtifact } from './artifactPreview';

test('only static sandbox-compatible artifacts expose message preview', () => {
  assert.equal(isPreviewableArtifact({ type: 'html' }), true);
  assert.equal(isPreviewableArtifact({ type: 'svg' }), true);
  assert.equal(isPreviewableArtifact({ type: 'react' }), false);
  assert.equal(isPreviewableArtifact({ type: 'code' }), false);
});
