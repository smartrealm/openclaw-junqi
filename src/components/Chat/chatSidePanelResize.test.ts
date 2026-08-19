import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_SIDE_PANEL_DEFAULT_WIDTH,
  CHAT_SIDE_PANEL_MAX_WIDTH,
  CHAT_SIDE_PANEL_MIN_WIDTH,
  clampChatSidePanelWidth,
  maximumChatSidePanelWidth,
} from './chatSidePanelResize';

test('消息预览宽度保留默认值并限制在容器可用范围内', () => {
  assert.equal(CHAT_SIDE_PANEL_DEFAULT_WIDTH, 720);
  assert.equal(maximumChatSidePanelWidth(), CHAT_SIDE_PANEL_MAX_WIDTH);
  assert.equal(maximumChatSidePanelWidth(1000), 700);
  assert.equal(maximumChatSidePanelWidth(360), CHAT_SIDE_PANEL_MIN_WIDTH);
  assert.equal(clampChatSidePanelWidth(200, 1000), CHAT_SIDE_PANEL_MIN_WIDTH);
  assert.equal(clampChatSidePanelWidth(900, 1000), 700);
  assert.equal(clampChatSidePanelWidth(1500, 2000), CHAT_SIDE_PANEL_MAX_WIDTH);
});
