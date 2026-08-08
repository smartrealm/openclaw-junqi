import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionFilePreviewFailure } from './sessionFilePreviewState';
import type { OpenClawSessionFile } from '@/services/gateway';

const baseFile: OpenClawSessionFile = {
  path: 'assets/example.svg',
  name: 'example.svg',
  kind: 'read',
  missing: false,
};

test('会话文件预览区分安全 MIME 不支持与内容缺失', () => {
  assert.equal(sessionFilePreviewFailure({
    ...baseFile,
    previewKind: 'image',
    contentEncoding: 'base64',
    content: 'PHN2Zy8+',
    mimeType: 'image/svg+xml',
  }), 'unsupported');
  assert.equal(sessionFilePreviewFailure({
    ...baseFile,
    previewKind: 'image',
    contentEncoding: 'base64',
    mimeType: 'image/png',
  }), 'contentUnavailable');
  assert.equal(sessionFilePreviewFailure({ ...baseFile, missing: true }), 'missing');
});
