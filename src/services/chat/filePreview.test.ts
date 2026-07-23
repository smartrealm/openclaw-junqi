import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeBase64Utf8,
  getFilePreviewKind,
  getLocalBinaryPreviewKind,
  loadLocalBinaryPreview,
  loadLocalFilePreview,
  readLocalTextPreview,
} from './filePreview';

test('CHAT-12 classifies only formats with a real inline renderer', () => {
  assert.equal(getFilePreviewKind('training/index.html'), 'html');
  assert.equal(getFilePreviewKind('notes.md'), 'markdown');
  assert.equal(getFilePreviewKind('diagram.webp'), 'image');
  assert.equal(getFilePreviewKind('slides.pptx'), null);
});

test('CHAT-12 HTML previews prefer the native scoped URL so sibling assets keep working', async () => {
  const preview = await loadLocalFilePreview('/Users/wei/Desktop/course/index.html', 'index.html', {
    managedFiles: {
      createPreview: async (path) => ({
        success: path.endsWith('/index.html'),
        url: 'junqi-preview://localhost/token/index.html',
      }),
    },
  });
  assert.deepEqual(preview, {
    kind: 'html',
    mode: 'interactive',
    url: 'junqi-preview://localhost/token/index.html',
  });
});

test('CHAT-12 text previews use the managed native reader before the scoped raw-file fallback', async () => {
  let rawReaderCalled = false;
  const preview = await readLocalTextPreview('/Users/wei/Desktop/notes.md', {
    managedFiles: {
      read: async (path) => ({
        success: true,
        content: path.endsWith('/notes.md') ? '# 会议纪要' : null,
        byteSize: 13,
        truncated: false,
      }),
    },
    file: {
      read: async () => {
        rawReaderCalled = true;
        return { base64: 'ZmFsbGJhY2s=' };
      },
    },
  });
  assert.equal(preview.content, '# 会议纪要');
  assert.equal(rawReaderCalled, false);
});

test('CHAT-12 static fallback and legacy raw reads preserve UTF-8 text', async () => {
  assert.equal(decodeBase64Utf8('5L2g5aW9'), '你好');
  const preview = await loadLocalFilePreview('/tmp/demo.html', 'demo.html', {
    file: {
      read: async () => ({ base64: 'PGgxPuS9oOWlvTwvaDE+' }),
    },
  });
  assert.deepEqual(preview, {
    kind: 'html',
    mode: 'static',
    content: '<h1>你好</h1>',
    truncated: false,
    byteSize: 0,
  });
});

test('FILE-01 binary previews use the scoped native URL instead of a raw file read', async () => {
  assert.equal(getLocalBinaryPreviewKind('recording.m4a'), 'audio');
  assert.equal(getLocalBinaryPreviewKind('report.pdf'), 'pdf');
  assert.equal(getLocalBinaryPreviewKind('scan.tiff'), 'image');
  assert.equal(getLocalBinaryPreviewKind('slides.pptx'), null);

  const preview = await loadLocalBinaryPreview('/Users/wei/Desktop/report.pdf', 'report.pdf', {
    managedFiles: {
      createPreview: async (path) => ({
        success: path.endsWith('/report.pdf'),
        url: 'junqi-preview://localhost/token/report.pdf',
      }),
    },
  });
  assert.deepEqual(preview, {
    kind: 'pdf',
    url: 'junqi-preview://localhost/token/report.pdf',
  });
});
