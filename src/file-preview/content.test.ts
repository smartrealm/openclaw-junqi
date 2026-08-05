import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayImagePreviewContent,
  managedFilePreviewContent,
  textFilePreviewContent,
  workspaceFilePreviewContent,
} from './content';

test('text preview content follows the existing filename capabilities', () => {
  assert.deepEqual(textFilePreviewContent('README.MD', '# Guide'), {
    kind: 'markdown',
    content: '# Guide',
    truncated: false,
  });
  assert.deepEqual(textFilePreviewContent('settings.json', '{"enabled":true}', true), {
    kind: 'json',
    content: '{"enabled":true}',
    truncated: true,
  });
  assert.deepEqual(textFilePreviewContent('LICENSE', 'MIT'), {
    kind: 'text',
    content: 'MIT',
    truncated: false,
  });
});

test('Gateway image previews accept only the OpenClaw session image MIME types', () => {
  assert.deepEqual(gatewayImagePreviewContent('image/PNG', 'AAE='), {
    kind: 'image',
    url: 'data:image/png;base64,AAE=',
  });
  assert.equal(gatewayImagePreviewContent('image/svg+xml', 'PHN2Zy8+'), null);
  assert.equal(gatewayImagePreviewContent('application/octet-stream', 'AAE='), null);
  assert.equal(gatewayImagePreviewContent(undefined, 'AAE='), null);
  assert.equal(gatewayImagePreviewContent('image/jpeg', ''), null);
});

test('workspace and managed previews preserve their established content authority', () => {
  assert.deepEqual(workspaceFilePreviewContent('report.pdf', {
    kind: 'pdf',
    text: null,
    base64: 'JVBERi0=',
    mimeType: 'application/pdf',
    byteLength: 5,
  }), {
    kind: 'pdf',
    source: { kind: 'base64', base64: 'JVBERi0=' },
  });
  assert.deepEqual(workspaceFilePreviewContent('payload.bin', {
    kind: 'binary',
    text: null,
    base64: null,
    mimeType: null,
    byteLength: 12,
  }), {
    kind: 'binary',
    byteLength: 12,
  });
  assert.deepEqual(managedFilePreviewContent({
    kind: 'html',
    mode: 'interactive',
    url: 'junqi-preview://localhost/token/index.html',
  }), {
    kind: 'html',
    mode: 'interactive',
    url: 'junqi-preview://localhost/token/index.html',
  });
});
