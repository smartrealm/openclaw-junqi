import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeBase64Utf8,
  getFilePreviewKind,
  loadLocalFilePreview,
  resolveLocalFileReference,
  readLocalTextPreview,
} from '@/runtime/filePreview';

test('CHAT-12 classifies only formats with a real inline renderer', () => {
  assert.equal(getFilePreviewKind('training/index.html'), 'html');
  assert.equal(getFilePreviewKind('notes.md'), 'markdown');
  assert.equal(getFilePreviewKind('component.mdx'), 'markdown');
  assert.equal(getFilePreviewKind('config.json'), 'json');
  assert.equal(getFilePreviewKind('diagram.webp'), 'image');
  assert.equal(getFilePreviewKind('recording.m4a'), 'audio');
  assert.equal(getFilePreviewKind('movie.mp4'), 'video');
  assert.equal(getFilePreviewKind('report.pdf'), 'pdf');
  assert.equal(getFilePreviewKind('budget.xlsx'), 'office');
  assert.equal(getFilePreviewKind('deck.pptx'), 'office');
  assert.equal(getFilePreviewKind('brief.docx'), 'office');
  assert.equal(getFilePreviewKind('Dockerfile'), 'text');
  assert.equal(getFilePreviewKind('slides.ppt'), null);
});

test('CHAT-18 previews OOXML files through the managed read-only bridge', async () => {
  const preview = await loadLocalFilePreview('/workspace/budget.xlsx', 'budget.xlsx', '/workspace', {
    managedFiles: {
      readOfficePreview: async (path, workspaceRoot) => ({
        success: path === '/workspace/budget.xlsx' && workspaceRoot === '/workspace',
        format: 'spreadsheet',
        content: 'Month\tRevenue\nJanuary\t100',
        truncated: false,
      }),
    },
  });
  assert.deepEqual(preview, {
    kind: 'text',
    content: 'Month\tRevenue\nJanuary\t100',
    truncated: false,
  });
});

test('CHAT-12 HTML previews prefer the native scoped URL so sibling assets keep working', async () => {
  const preview = await loadLocalFilePreview('/Users/wei/Desktop/course/index.html', 'index.html', undefined, {
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
  const preview = await loadLocalFilePreview('/tmp/demo.html', 'demo.html', undefined, {
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
  const preview = await loadLocalFilePreview('/Users/wei/Desktop/report.pdf', 'report.pdf', undefined, {
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

test('FILE-02 Markdown resources resolve beside their owner without escaping an absolute root', () => {
  assert.equal(
    resolveLocalFileReference('../images/diagram.png', '/Users/wei/docs/guide/readme.md'),
    null,
  );
  assert.equal(
    resolveLocalFileReference('../../../../etc/passwd', '/Users/wei/docs/readme.md'),
    null,
  );
  assert.equal(
    resolveLocalFileReference('../images/diagram.png', '/Users/wei/docs/guide/readme.md', '/Users/wei/docs'),
    '/Users/wei/docs/images/diagram.png',
  );
  assert.equal(
    resolveLocalFileReference('..\\images\\diagram.png', 'C:\\Users\\wei\\docs\\guide\\readme.md', 'C:\\Users\\wei\\docs'),
    'C:/Users/wei/docs/images/diagram.png',
  );
  assert.equal(resolveLocalFileReference('https://example.com/image.png', '/tmp/readme.md'), null);
});
