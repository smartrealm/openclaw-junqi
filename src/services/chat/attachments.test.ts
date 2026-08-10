import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AttachmentValidationError,
  createPreparedAttachment,
  inferMimeType,
  resolveAttachmentByteLimit,
  restoreOpenClawEditorImages,
  toGatewayAttachments,
} from './attachments';

const MIB = 1024 * 1024;
const POLICY = Object.freeze({
  maxPayload: 25 * MIB,
  maxBytes: 20 * MIB,
  maxImageBytes: 6 * MIB,
});

test('CHAT-04 regular files use binary-safe official Gateway attachments', () => {
  const file = createPreparedAttachment({
    fileName: 'contract.pdf',
    base64: 'AAECAw==',
    size: 4,
  });
  assert.equal(inferMimeType(file.fileName ?? ''), 'application/pdf');
  assert.deepEqual(toGatewayAttachments([file], POLICY), [{
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
    size: POLICY.maxBytes + 1,
  });
  assert.throws(
    () => toGatewayAttachments([file], POLICY),
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
  assert.deepEqual(toGatewayAttachments(restored, POLICY), [{
    type: 'image',
    mimeType: 'image/png',
    content: 'aW1hZ2U=',
  }]);
});

test('附件上限随当前 Gateway 策略变化', () => {
  const file = createPreparedAttachment({
    fileName: 'runtime-configured.bin',
    mimeType: 'application/octet-stream',
    base64: 'AA==',
    size: 2 * MIB,
  });

  assert.doesNotThrow(() => toGatewayAttachments([file], {
    maxPayload: 8 * MIB,
    maxBytes: 3 * MIB,
    maxImageBytes: 2 * MIB,
  }));
  assert.throws(
    () => toGatewayAttachments([file], {
      maxPayload: 8 * MIB,
      maxBytes: MIB,
      maxImageBytes: MIB,
    }),
    (error: unknown) => error instanceof AttachmentValidationError
      && error.code === 'FILE_SIZE_LIMIT'
      && error.details.maxBytes === MIB,
  );
});

test('旧 Gateway 缺少附件字段时只使用必然的帧编码上限', () => {
  assert.equal(resolveAttachmentByteLimit({ maxPayload: 8 * MIB }, false), 6 * MIB);
});

test('客户端不猜测 Gateway 的附件数量限制', () => {
  const files = Array.from({ length: 12 }, (_, index) => createPreparedAttachment({
    fileName: `item-${index}.txt`,
    mimeType: 'text/plain',
    base64: 'YQ==',
    size: 1,
  }));
  assert.doesNotThrow(() => toGatewayAttachments(files, POLICY));
});
