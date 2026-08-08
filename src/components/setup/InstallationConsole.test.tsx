import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstallationConsole, installationConsoleMode } from './SetupFlowPanels';

test('Gateway 检查点使用紧凑摘要，安装活动保持完整视图', () => {
  assert.equal(installationConsoleMode({ kind: 'gateway-ready' }), 'checkpoint');
  assert.equal(installationConsoleMode({ kind: 'installation' }), 'activity');
  assert.equal(installationConsoleMode({ kind: 'model-checking' }), 'checkpoint');
  assert.equal(
    installationConsoleMode({ kind: 'model-check-failed', message: 'failed' }),
    'checkpoint',
  );
});

test('Gateway 就绪默认保留完成摘要并折叠安装详情', () => {
  const html = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        steps: [
          { id: 'git', label: 'Git', status: 'done' },
          { id: 'node', label: 'Node.js', status: 'done' },
          { id: 'openclaw', label: 'OpenClaw', status: 'done' },
          { id: 'gateway', label: 'Gateway', status: 'done' },
        ],
        installTarget: null,
      }}
      logs={[]}
      setupStep="gateway-ready"
      summary={{ kind: 'gateway-ready' }}
    />,
  );

  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /data-installation-checkpoint="runtime-complete"/);
  assert.match(html, /View installation details/);
  assert.match(html, /4\/4 runtime checks complete/);
  assert.doesNotMatch(html, /Ready!/);
  assert.doesNotMatch(html, /100%/);
  assert.doesNotMatch(html, /id="setup-installation-details"/);
});

test('配置核验失败不会把已完成的运行时检查点标记为失败', () => {
  const html = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        steps: [
          { id: 'openclaw', label: 'OpenClaw', status: 'done' },
          { id: 'gateway', label: 'Gateway', status: 'done' },
        ],
        installTarget: null,
      }}
      logs={[]}
      setupStep="gateway-ready"
      summary={{ kind: 'model-check-failed', message: 'Model verification failed' }}
    />,
  );

  assert.match(html, /data-installation-checkpoint="runtime-complete"/);
  assert.match(html, /2\/2 runtime checks complete/);
  assert.doesNotMatch(html, /Model verification failed/);
});
