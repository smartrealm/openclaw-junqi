import test from 'node:test';
import assert from 'node:assert/strict';
import { safeChannelEnrollmentQrDataUrl } from './channelEnrollment';

test('accepts only inline QR image data that the dialog can render locally', () => {
  assert.equal(safeChannelEnrollmentQrDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  assert.equal(safeChannelEnrollmentQrDataUrl('data:image/svg+xml;base64,AAAA'), 'data:image/svg+xml;base64,AAAA');
  assert.equal(safeChannelEnrollmentQrDataUrl('https://accounts.feishu.cn/qr.png'), null);
  assert.equal(safeChannelEnrollmentQrDataUrl('data:image/png;base64,'), null);
  assert.equal(safeChannelEnrollmentQrDataUrl(null), null);
});
