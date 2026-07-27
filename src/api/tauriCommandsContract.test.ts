import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const commands = readFileSync(new URL('./tauri-commands.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('./tauri-adapter.ts', import.meta.url), 'utf8');
const logPanel = readFileSync(
  new URL('../components/settings/GatewayLogPanel.tsx', import.meta.url),
  'utf8',
);
const wizard = readFileSync(
  new URL('../hooks/useSetupFlow/useWizardSession.ts', import.meta.url),
  'utf8',
);
const gateway = readFileSync(
  new URL('../../src-tauri/src/commands/gateway.rs', import.meta.url),
  'utf8',
);
const ensure = readFileSync(
  new URL('../../src-tauri/src/commands/ensure.rs', import.meta.url),
  'utf8',
);
const gatewayProcess = readFileSync(
  new URL('../../src-tauri/src/state/gateway_process.rs', import.meta.url),
  'utf8',
);

test('Tauri command wrappers match the Rust Gateway result contracts', () => {
  assert.match(gateway, /pub async fn start_gateway\([\s\S]*?Result<GatewayStatus, String>/);
  assert.match(commands, /invoke<GatewayStatus>\("start_gateway"/);
  assert.doesNotMatch(commands, /invoke<any>\("start_gateway"/);

  const rustLogLevel = gatewayProcess.slice(
    gatewayProcess.indexOf('pub enum LogLevel'),
    gatewayProcess.indexOf('pub enum LogSource'),
  );
  assert.match(rustLogLevel, /Info/);
  assert.match(rustLogLevel, /Warn/);
  assert.match(rustLogLevel, /Error/);
  assert.doesNotMatch(rustLogLevel, /\n\s+(?:Trace|Debug),/);
  assert.match(commands, /export type LogLevel = 'info' \| 'warn' \| 'error'/);
});

test('ensure documentation follows the selected-runtime-only Rust policy', () => {
  assert.match(ensure, /切换运行时必须经过显式设置流程/);
  assert.match(commands, /only the persisted runtime selected by the user/);
  assert.doesNotMatch(commands, /Tries native|Debounced to one call per 60s/);
});

test('shared Gateway commands have one renderer invocation boundary', () => {
  for (const source of [adapter, logPanel, wizard]) {
    assert.doesNotMatch(
      source,
      /invoke(?:<[^>]+>)?\(["'](?:check_openclaw|start_gateway|ensure_gateway_running|get_gateway_logs|clear_gateway_logs|handoff_gateway_to_official_service)["']/,
    );
  }
  assert.match(adapter, /await checkOpenclaw\(\)/);
  assert.match(adapter, /await startGateway\(\)/);
  assert.match(adapter, /await ensureGatewayRunning\(\)/);
  assert.match(logPanel, /await getGatewayLogs\(200\)/);
  assert.match(wizard, /await handoffGatewayToOfficialService\(\)/);
});
