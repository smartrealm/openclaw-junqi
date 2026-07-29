import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPreviewableArtifact, isPreviewableArtifact } from './artifactPreview';

test('only static sandbox-compatible artifacts expose message preview', () => {
  assert.equal(isPreviewableArtifact({ type: 'html' }), true);
  assert.equal(isPreviewableArtifact({ type: 'svg' }), true);
  assert.equal(isPreviewableArtifact({ type: 'react' }), false);
  assert.equal(isPreviewableArtifact({ type: 'code' }), false);
});

test('message preview capability is derived from its artifacts', () => {
  assert.equal(hasPreviewableArtifact([{ type: 'code' }, { type: 'markdown' }]), false);
  assert.equal(hasPreviewableArtifact([{ type: 'code' }, { type: 'html' }]), true);
});
