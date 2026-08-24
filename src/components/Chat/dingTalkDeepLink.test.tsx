import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdownRenderer } from './ChatMarkdownRenderer';

const ATTENDANCE_LINK = 'dingtalk://dingtalkclient/action/openapp?app_id=-4&container_type=work_platform';
const REPORT_LINK = 'dingtalk://dingtalkclient/page/link?url=https%3A%2F%2Fexample.com';

test('DWS 钉钉深链在 Chat Markdown 中保留可点击地址与桌面打开提示', () => {
  const html = renderToStaticMarkup(
    <ChatMarkdownRenderer markdown={`[请假申请](${ATTENDANCE_LINK})`} />,
  );

  assert.match(html, /href="dingtalk:\/\/dingtalkclient\/action\/openapp\?/);
  assert.match(html, /title="Open in DingTalk desktop client"/);
  assert.match(html, /cursor-pointer/);
});

test('Tauri Opener 范围只放行已核验的钉钉深链路径', () => {
  const capability = JSON.parse(readFileSync(
    new URL('../../../src-tauri/capabilities/default.json', import.meta.url),
    'utf8',
  )) as {
    permissions?: Array<string | { identifier?: unknown; allow?: Array<{ url?: unknown }> }>;
  };
  const openerPermission = capability.permissions?.find((permission) => (
    typeof permission === 'object' && permission.identifier === 'opener:allow-open-url'
  ));
  const allowedUrls = typeof openerPermission === 'object'
    ? openerPermission.allow?.map((entry) => entry.url)
    : undefined;

  assert.deepEqual(allowedUrls, [
    'https://*',
    'http://*',
    'mailto:*',
    'tel:*',
    'dingtalk://dingtalkclient/action/openapp*',
    'dingtalk://dingtalkclient/page/link*',
  ]);
  assert.match(ATTENDANCE_LINK, /^dingtalk:\/\/dingtalkclient\/action\/openapp\?/);
  assert.match(REPORT_LINK, /^dingtalk:\/\/dingtalkclient\/page\/link\?/);
});
