import assert from 'node:assert/strict';
import test from 'node:test';
import { getFileName, getFileParentFolder } from './filePresentation';

test('CHAT-12 compact file rows retain the filename and nearest parent folder only', () => {
  const path = '/Users/wei/Desktop/大夏集团/2026-06-08-培训项目/企业AI落地培训课件/index.html';
  assert.equal(getFileName(path), 'index.html');
  assert.equal(getFileParentFolder(path), '企业AI落地培训课件');
});

test('CHAT-12 compact file rows normalize Windows paths and file URLs', () => {
  assert.equal(getFileName('C:\\work\\reports\\summary.html'), 'summary.html');
  assert.equal(getFileParentFolder('C:\\work\\reports\\summary.html'), 'reports');
  assert.equal(getFileParentFolder('file:///Users/wei/Desktop/course/index.html'), 'course');
});
