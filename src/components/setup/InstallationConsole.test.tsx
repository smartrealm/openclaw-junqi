import '../../../test-setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstallationConsole } from './SetupFlowPanels';

test('安装控制台持续呈现当前执行和安装详情', () => {
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
      setupStep="checking"
    />,
  );

  assert.match(html, /id="setup-installation-details"/);
  assert.match(html, /4\/4 steps handled/);
  assert.match(html, /100%/);
});
