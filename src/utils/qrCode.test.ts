import assert from "node:assert/strict";
import test from "node:test";
import { renderLocalQrDataUrl } from "./qrCode";

test("将官方授权地址编码为本地 PNG 二维码", async () => {
  const result = await renderLocalQrDataUrl(
    "https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=test&source=DING_DWS_CLAW",
  );

  assert.match(result ?? "", /^data:image\/png;base64,/);
});

test("拒绝空载荷、控制字符和超长载荷", async () => {
  assert.equal(await renderLocalQrDataUrl("   "), null);
  assert.equal(await renderLocalQrDataUrl("https://example.com/one\nhttps://example.com/two"), null);
  assert.equal(await renderLocalQrDataUrl("x".repeat(16 * 1024 + 1)), null);
});
