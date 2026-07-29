import assert from 'node:assert/strict';
import test from 'node:test';
import { describeWorkspaceFile, fileExtension, isImageFile, workspaceFileKind } from './fileKinds';

test('workspace file kinds are classified by one case-insensitive authority', () => {
  assert.equal(workspaceFileKind('training/index.HTML'), 'html');
  assert.equal(workspaceFileKind('notes.MD'), 'markdown');
  assert.equal(workspaceFileKind('guide.mdx'), 'markdown');
  assert.equal(workspaceFileKind('diagram.webp'), 'image');
  assert.equal(workspaceFileKind('recording.m4a'), 'audio');
  assert.equal(workspaceFileKind('movie.MOV'), 'video');
  assert.equal(workspaceFileKind('report.pdf'), 'pdf');
  assert.equal(workspaceFileKind('src/App.tsx'), 'code');
  assert.equal(workspaceFileKind('README'), 'text');
  assert.equal(workspaceFileKind('Dockerfile'), 'code');
  assert.equal(workspaceFileKind('Makefile'), 'code');
  assert.equal(workspaceFileKind('.gitignore'), 'unsupported');
  assert.equal(workspaceFileKind('slides.pptx'), 'unsupported');
});

test('file extension handles Windows paths, URLs and compound names', () => {
  assert.equal(fileExtension('C:\\work\\src\\App.TSX'), 'tsx');
  assert.equal(fileExtension('file:///tmp/image.PNG?token=redacted#preview'), 'png');
  assert.equal(fileExtension('archive.tar.gz'), 'gz');
  assert.equal(fileExtension('name.'), '');
});

test('descriptors expose edit and native preview capabilities', () => {
  assert.deepEqual(describeWorkspaceFile('notes.md'), {
    kind: 'markdown',
    editable: true,
    previewable: true,
    requiresNativeUrl: false,
    mimeType: 'text/markdown',
    maxInlineBytes: 2 * 1024 * 1024,
  });
  assert.equal(describeWorkspaceFile('report.pdf').requiresNativeUrl, true);
  assert.equal(describeWorkspaceFile('slides.pptx').previewable, false);
  assert.equal(isImageFile('scan.TIFF'), true);
});
