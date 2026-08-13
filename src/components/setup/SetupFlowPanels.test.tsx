import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstallationConsole, SetupShell } from './SetupFlowPanels';

test('setup footer renders Back separately from a loading primary action', () => {
  const markup = renderToStaticMarkup(
    <SetupShell
      active={2}
      title="Storage"
      subtitle="Configure the workspace"
      logs={[]}
      previousAction={{ label: 'Back' }}
      secondaryAction={{ label: 'Choose location' }}
      nextAction={{ label: 'Confirming storage location', loading: true }}
    >
      <div>Storage setup</div>
    </SetupShell>,
  );

  assert.match(markup, /data-setup-footer-layout="responsive"/);
  assert.match(markup, /data-setup-footer-previous="true"/);
  assert.match(markup, /data-setup-footer-actions="true"/);
  assert.match(markup, /data-setup-footer-primary="true"/);
  assert.match(markup, /Confirming storage location/);
});

test('运行时日志默认收起并可由用户主动展开', () => {
  const markup = renderToStaticMarkup(
    <SetupShell
      active={3}
      title="配置"
      subtitle="官方向导"
      logs={[{ source: 'gateway', message: '等待确认', ts: 0, level: 'info' }]}
    >
      <div>确认现有凭据</div>
    </SetupShell>,
  );

  assert.match(markup, /setup\.viewLogs|View logs/);
  assert.doesNotMatch(markup, /Debug Log/);
  assert.doesNotMatch(markup, /等待确认/);
});

test('没有日志时不展示空日志区域', () => {
  const markup = renderToStaticMarkup(
    <SetupShell
      active={3}
      title="配置"
      subtitle="官方向导"
      logs={[]}
    >
      <div>等待 Runtime 返回步骤</div>
    </SetupShell>,
  );

  assert.doesNotMatch(markup, /View logs/);
  assert.doesNotMatch(markup, /Debug Log/);
});

test('安装进度使用主题状态色区分运行和失败', () => {
  const runningMarkup = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        installTarget: null,
        gatewayReadyContinuation: { status: 'idle', error: null },
        steps: [{ id: 'gateway', label: 'Gateway', status: 'running', progress: 50 }],
      }}
      logs={[]}
      setupStep="gateway"
    />,
  );
  const failedMarkup = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        installTarget: null,
        gatewayReadyContinuation: { status: 'idle', error: null },
        steps: [{ id: 'gateway', label: 'Gateway', status: 'error' }],
      }}
      logs={[]}
      setupStep="error"
    />,
  );

  assert.match(runningMarkup, /bg-aegis-primary/);
  assert.match(runningMarkup, /animate-pulse/);
  assert.match(failedMarkup, /bg-aegis-danger/);
  assert.doesNotMatch(runningMarkup + failedMarkup, /linear-gradient|box-shadow/);
});

test('依赖安装宽窗口左右展示步骤与记录，窄窗口使用切换', () => {
  const markup = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        installTarget: null,
        gatewayReadyContinuation: { status: 'idle', error: null },
        steps: [{ id: 'gateway', label: 'Gateway', status: 'error' }],
      }}
      logs={[{ source: 'gateway', message: '连接诊断详情', ts: 0, level: 'error' }]}
      setupStep="error"
    />,
  );

  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /lg:grid-cols/);
  assert.match(markup, /data-setup-installation-log/);
  assert.match(markup, /连接诊断详情/);
});

test('Gateway 核验完成直接替换安装摘要，不生成独立完成卡片', () => {
  const markup = renderToStaticMarkup(
    <InstallationConsole
      flow={{
        installTarget: null,
        gatewayReadyContinuation: { status: 'idle', error: null },
        steps: [{ id: 'gateway', label: 'Gateway', status: 'done' }],
      }}
      logs={[]}
      setupStep="gateway-ready"
    />,
  );

  assert.match(markup, /Gateway connection and runtime identity verified/);
  assert.match(markup, /Runtime checks are complete/);
  assert.match(markup, /bg-aegis-success/);
});
