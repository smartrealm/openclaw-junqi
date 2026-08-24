import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DesktopExternalLinkError,
  openDesktopExternalLink,
  resolveDesktopExternalLink,
} from './desktopExternalLink';

const ATTENDANCE_LINK = 'dingtalk://dingtalkclient/action/openapp?app_id=-4&container_type=work_platform';
const REPORT_LINK = 'dingtalk://dingtalkclient/page/link?url=https%3A%2F%2Fexample.com%2Freport';

test('桌面外部链接分类只接受已核验的钉钉深链', () => {
  assert.deepEqual(resolveDesktopExternalLink(ATTENDANCE_LINK), {
    href: ATTENDANCE_LINK,
    kind: 'dingtalk',
  });
  assert.deepEqual(resolveDesktopExternalLink(REPORT_LINK), {
    href: REPORT_LINK,
    kind: 'dingtalk',
  });
  assert.equal(resolveDesktopExternalLink('dingtalk://attacker/action/openapp?app_id=-4'), null);
  assert.equal(resolveDesktopExternalLink('dingtalk://dingtalkclient/action/unknown?app_id=-4'), null);
  assert.equal(resolveDesktopExternalLink('dingtalk://dingtalkclient/page/link?url=javascript%3Aalert(1)'), null);
  assert.equal(resolveDesktopExternalLink('dingtalk://dingtalkclient/action/openapp?x=%0a'), null);
  assert.equal(resolveDesktopExternalLink('javascript:alert(1)'), null);
});

test('桌面运行时将钉钉深链原样交给 Tauri 打开器', async () => {
  const opened: string[] = [];
  await openDesktopExternalLink(ATTENDANCE_LINK, {
    isDesktopRuntime: () => true,
    openDesktop: async (href) => { opened.push(href); },
  });
  assert.deepEqual(opened, [ATTENDANCE_LINK]);
});

test('Tauri 打开失败时不静默回退到浏览器', async () => {
  let browserOpenCount = 0;
  await assert.rejects(
    openDesktopExternalLink(ATTENDANCE_LINK, {
      isDesktopRuntime: () => true,
      openDesktop: async () => { throw new Error('rejected'); },
      openBrowser: () => { browserOpenCount += 1; },
    }),
    (error: unknown) => error instanceof DesktopExternalLinkError && error.code === 'open-failed',
  );
  assert.equal(browserOpenCount, 0);
});

test('浏览器环境拒绝伪装为已打开钉钉客户端', async () => {
  await assert.rejects(
    openDesktopExternalLink(ATTENDANCE_LINK, {
      isDesktopRuntime: () => false,
      openBrowser: () => { throw new Error('不应调用浏览器打开器'); },
    }),
    (error: unknown) => error instanceof DesktopExternalLinkError && error.code === 'desktop-required',
  );
});

test('浏览器开发环境仍可打开普通网页链接', async () => {
  const opened: string[] = [];
  await openDesktopExternalLink('https://example.com/report', {
    isDesktopRuntime: () => false,
    openBrowser: (href) => { opened.push(href); },
  });
  assert.deepEqual(opened, ['https://example.com/report']);
});
