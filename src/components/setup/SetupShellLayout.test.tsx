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
      eyebrow="Step 3 · Runtime"
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
  assert.match(html, /<main[^>]*overflow-y-auto/);
  assert.match(html, /grid-cols-5/);
  assert.doesNotMatch(html, /overflow-x-auto/);
  assert.match(html, /data-setup-step-current-complete="true"/);
  assert.match(html, /Step 3 · Runtime/);
  assert.match(html, /class="flex w-full min-w-0 max-w-full justify-center overflow-x-clip"/);
  assert.match(html, /<section[^>]*class="w-full max-w-3xl"/);
  assert.doesNotMatch(html, /<section[^>]*class="[^"]*my-auto/);
  assert.match(html, /<footer[^>]*shrink-0/);
  assert.match(html, />Continue</);
});

test('运行时检测与复核共享稳定的窗口自适应内容区域', () => {
  const html = renderToStaticMarkup(
    <SetupShell
      active={0}
      title="环境检测"
      subtitle="确认 OpenClaw 与 Gateway"
      logs={[]}
      contentSizing="runtime"
      nextAction={{ label: '正在检测', disabled: true, loading: true }}
    >
      <div>检测状态</div>
    </SetupShell>,
  );

  assert.match(html, /data-setup-content-sizing="runtime"/);
  assert.match(html, /min-h-0 flex-1/);
  assert.match(html, /flex h-full min-h-0 flex-col/);
  assert.match(html, /overflow-hidden/);
  assert.match(html, /overflow-y-auto overscroll-contain/);
  assert.match(html, /\[scrollbar-gutter:stable\]/);
});
