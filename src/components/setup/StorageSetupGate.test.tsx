import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { StorageSetupStep } from './StorageSetupGate';

test('存储步骤初次读取时保持表单几何且不闪现技术状态', () => {
  let completions = 0;
  const html = renderToStaticMarkup(
    <StorageSetupStep
      activeStage={1}
      onReady={() => { completions += 1; }}
      onBack={() => undefined}
      logs={[]}
    />,
  );

  assert.match(html, /data-setup-content-layout="stable"/);
  assert.match(html, /data-setup-content-motion="storage:form"/);
  assert.match(html, /data-testid="storage-form-skeleton"/);
  assert.match(html, /aria-busy="true"/);
  assert.doesNotMatch(html, />Reading storage information/);
  assert.doesNotMatch(html, /animate-(?:spin|pulse)/);
  assert.match(html, /Choose OpenClaw data location/);
  assert.equal((html.match(/Choose OpenClaw data location/g) ?? []).length, 1);
  assert.equal(completions, 0);
});
