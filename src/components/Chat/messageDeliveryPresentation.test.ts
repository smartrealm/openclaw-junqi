import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleDeliveryFailureDetail } from './messageDeliveryPresentation';

test('保留 Gateway 已确认的发送失败原因供消息附近展示', () => {
  assert.equal(
    visibleDeliveryFailureDetail("invalid chat.send params: at root: unexpected property 'queueMode'"),
    "invalid chat.send params: at root: unexpected property 'queueMode'",
  );
  assert.equal(visibleDeliveryFailureDetail('   '), null);
});
