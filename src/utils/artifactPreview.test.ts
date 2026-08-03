import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArtifactSummary } from '@/services/gateway/artifacts';
import { artifactDownloadToPreview } from './artifactPreview';

function artifact(overrides: Partial<ArtifactSummary> = {}): ArtifactSummary {
  return {
    id: 'artifact_1',
    type: 'file',
    title: 'notes.md',
    mimeType: 'text/markdown',
    sizeBytes: 9,
    download: { mode: 'bytes' },
    ...overrides,
  };
}

test('artifact previews decode Markdown and media through the managed preview model', () => {
  const markdown = artifactDownloadToPreview(artifact(), {
    artifact: artifact(),
    encoding: 'base64',
    data: 'IyBoZWxsbyE=',
  });
  assert.deepEqual(markdown, {
    kind: 'markdown',
    content: '# hello!',
    truncated: false,
  });

  const imageArtifact = artifact({ title: 'diagram.png', mimeType: 'image/png' });
  const image = artifactDownloadToPreview(imageArtifact, {
    artifact: imageArtifact,
    encoding: 'base64',
    data: 'aW1hZ2U=',
  });
  assert.deepEqual(image, { kind: 'image', url: 'data:image/png;base64,aW1hZ2U=' });
});

test('artifact previews keep unsafe or oversized content out of the inline renderer', () => {
  const large = artifact({ sizeBytes: 8 * 1024 * 1024 + 1 });
  assert.equal(
    artifactDownloadToPreview(large, { artifact: large, encoding: 'base64', data: 'IyBoZWxsbyE=' }),
    null,
  );

  const binary = artifact({ title: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  assert.equal(
    artifactDownloadToPreview(binary, { artifact: binary, encoding: 'base64', data: 'YmluYXJ5' }),
    null,
  );
});
