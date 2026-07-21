import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTACHMENT_LIMITS,
  AttachmentValidationError,
  createPreparedAttachment,
  inferMimeType,
  toGatewayAttachments,
} from './attachments';

test('CHAT-04 regular files use binary-safe official Gateway attachments', () => {
  const file = createPreparedAttachment({
    fileName: 'contract.pdf',
    base64: 'AAECAw==',
    size: 4,
  });
  assert.equal(inferMimeType(file.fileName), 'application/pdf');
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
