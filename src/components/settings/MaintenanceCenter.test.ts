import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('maintenance scan uses structured read-only OpenClaw diagnostics', () => {
  const rust = source('src-tauri/src/commands/maintenance.rs');
  const lib = source('src-tauri/src/lib.rs');

  assert.match(rust, /\["config", "validate", "--json"\]/);
  assert.match(rust, /\["doctor", "--lint", "--json"\]/);
  assert.match(rust, /parse it regardless of exit status/);
  assert.match(rust, /CONFIG_TIMEOUT/);
  assert.match(rust, /DOCTOR_TIMEOUT/);
  assert.match(rust, /deduplicate\(&mut report\.findings\)/);
  assert.match(rust, /acquire_operation_guard/);
  assert.match(lib, /commands::maintenance::run_maintenance_scan/);
});

test('maintenance UI is deep-linkable and reuses canonical Gateway status', () => {
  const settings = source('src/pages/SettingsPage.tsx');
  const center = source('src/components/settings/MaintenanceCenter.tsx');

  assert.match(settings, /\| 'maintenance'/);
  assert.match(settings, /activeTab === 'maintenance'/);
  assert.match(settings, /settings\.tab\.maintenance/);
  assert.match(center, /runMaintenanceScan/);
  assert.match(center, /<GatewayLifecyclePanel variant="full"/);
  assert.match(center, /showConfirm\(/);
  assert.match(center, /openclaw_doctor_repair/);
});

test('repair and scan share one backend operation lock', () => {
  const maintenance = source('src-tauri/src/commands/maintenance.rs');
  const supervisor = source('src-tauri/src/commands/gateway_supervisor.rs');

  assert.match(maintenance, /static MAINTENANCE_OPERATION/);
  assert.match(supervisor, /maintenance::acquire_operation_guard\(\)\.await/);
});
