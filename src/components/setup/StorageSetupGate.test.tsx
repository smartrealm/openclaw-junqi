import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorageSetupStep } from './StorageSetupGate';

test('存储步骤加载时沿用首次设置稳定骨架并展示真实状态', () => {
  const html = renderToStaticMarkup(
    <StorageSetupStep
      activeStage={1}
      onReady={() => undefined}
      onBack={() => undefined}
      logs={[]}
    />,
  );

  assert.match(html, /data-setup-content-layout="stable"/);
  assert.match(html, /data-setup-content-motion="storage:loading"/);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Reading storage information/);
  assert.match(html, /Choose OpenClaw data location/);
  assert.equal((html.match(/Choose OpenClaw data location/g) ?? []).length, 1);
});
