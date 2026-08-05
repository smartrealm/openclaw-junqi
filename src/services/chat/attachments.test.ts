import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTACHMENT_LIMITS,
  AttachmentValidationError,
  createPreparedAttachment,
  inferMimeType,
  restoreOpenClawEditorImages,
  toGatewayAttachments,
} from './attachments';

test('CHAT-04 regular files use binary-safe official Gateway attachments', () => {
  const file = createPreparedAttachment({
    fileName: 'contract.pdf',
    base64: 'AAECAw==',
    size: 4,
  });
  assert.equal(inferMimeType(file.fileName ?? ''), 'application/pdf');
  assert.deepEqual(toGatewayAttachments([file]), [{
    type: 'file',
    mimeType: 'application/pdf',
    content: 'AAECAw==',
    fileName: 'contract.pdf',
  }]);
});

test('CHAT-04 attachment validation rejects oversized payloads before send', () => {
  const file = createPreparedAttachment({
    fileName: 'large.bin',
    mimeType: 'application/octet-stream',
    base64: 'AA==',
    size: ATTACHMENT_LIMITS.maxFileBytes + 1,
  });
  assert.throws(
    () => toGatewayAttachments([file]),
    (error: unknown) => error instanceof AttachmentValidationError && error.code === 'FILE_SIZE_LIMIT',
  );
});

test('OpenClaw 消息截断仅恢复受限图片并保留缺失文件名', () => {
  const restored = restoreOpenClawEditorImages([
    { mimeType: 'image/png', data: 'aW1hZ2U=' },
    { mimeType: 'application/pdf', data: 'cGRm' },
    { mimeType: 'image/jpeg', data: 'not-base64' },
    { mimeType: 'image/gif', data: 'A'.repeat(7_000_000) },
  ]);

  assert.equal(restored.length, 1);
  assert.equal(restored[0]?.fileName, undefined);
  assert.equal(restored[0]?.preview, 'data:image/png;base64,aW1hZ2U=');
  assert.deepEqual(toGatewayAttachments(restored), [{
    type: 'image',
    mimeType: 'image/png',
    content: 'aW1hZ2U=',
  }]);
});
