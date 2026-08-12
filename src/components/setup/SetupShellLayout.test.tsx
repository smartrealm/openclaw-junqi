import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { SetupShell } from './SetupFlowPanels';

test('setup shell keeps navigation actions reachable below overflowing step content', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={2}
      activeComplete
      title="Data location"
      subtitle="Choose storage"
      logs={[]}
      previousAction={{ onClick: () => undefined }}
      nextAction={{ label: 'Continue', onClick: () => undefined }}
    >
      <div>Storage choices</div>
    </SetupShell>,
  );

  assert.match(html, /<main[^>]*overflow-x-hidden/);
  assert.match(html, /<main[^>]*overflow-y-hidden/);
  assert.match(html, /grid-cols-5/);
  assert.doesNotMatch(html, /overflow-x-auto/);
  assert.match(html, /data-setup-step-current-complete="true"/);
  assert.match(html, /class="flex w-full min-w-0 max-w-full justify-center overflow-x-clip min-h-0 flex-1"/);
  assert.match(html, /<section[^>]*class="flex h-full min-h-0 w-full flex-col max-w-3xl"/);
  assert.doesNotMatch(html, /<section[^>]*class="[^"]*my-auto/);
  assert.match(html, /<footer[^>]*shrink-0/);
  assert.match(html, /data-setup-footer-primary[^>]*focus-visible:ring-2/);
  assert.match(html, />Continue</);
});

test('全部首次设置页面共享稳定的窗口自适应内容区域', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={0}
      title="环境检测"
      subtitle="确认 OpenClaw 与 Gateway"
      logs={[]}
      nextAction={{ label: '正在检测', disabled: true, loading: true }}
    >
      <div>检测状态</div>
    </SetupShell>,
  );

  assert.match(html, /data-setup-content-layout="stable"/);
  assert.match(html, /min-h-0 flex-1/);
  assert.match(html, /flex h-full min-h-0 w-full flex-col/);
  assert.match(html, /overflow-hidden/);
  assert.match(html, /overscroll-contain overflow-y-auto/);
  assert.match(html, /\[scrollbar-gutter:stable\]/);
});

test('官方向导在稳定主体内切换内容而不重建页面滚动容器', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={3}
      title="QuickStart"
      subtitle="当前步骤由 OpenClaw Runtime 提供"
      logs={[]}
      contentIdentity="quickstart-note"
      nextAction={{ label: '下一步' }}
    >
      <div>官方步骤正文</div>
    </SetupShell>,
  );

  assert.match(html, /data-setup-content-layout="stable"/);
  assert.match(html, /data-setup-content-motion="quickstart-note"/);
  assert.match(html, /<main[^>]*data-setup-scroll-key="quickstart-note"/);
  assert.match(html, /<main[^>]*overflow-y-hidden/);
  assert.match(html, /data-setup-content-viewport="stable"/);
});

test('首屏在桌面默认高度完整展示且不创建卡片内部滚动条', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={0}
      title="欢迎使用 JunQi Desktop"
      subtitle="选择语言和主题"
      logs={[]}
      contentOverflow="visible"
      nextAction={{ label: '下一步' }}
    >
      <div>语言与主题</div>
    </SetupShell>,
  );

  assert.match(html, /data-setup-content-overflow="visible"/);
  assert.match(html, /overflow-y-visible/);
  assert.doesNotMatch(html, /data-setup-content-overflow="visible"[^>]*overflow-y-auto/);
});
