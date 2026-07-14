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
  assert.match(center, /run_maintenance_repair/);
});

test('repair and scan share one backend operation lock', () => {
  const maintenance = source('src-tauri/src/commands/maintenance.rs');
  const lib = source('src-tauri/src/lib.rs');

  assert.match(maintenance, /static MAINTENANCE_OPERATION/);
  assert.match(maintenance, /run_maintenance_repair[\s\S]*acquire_operation_guard\(\)\.await/);
  assert.match(lib, /commands::maintenance::run_maintenance_repair/);
});

test('BUG-M01 and BUG-M02 structured payloads fail closed and preserve config issues', () => {
  const maintenance = source('src-tauri/src/commands/maintenance.rs');
  assert.match(maintenance, /struct ConfigValidationEnvelope[\s\S]*valid: bool[\s\S]*issues: Vec<Value>/);
  assert.match(maintenance, /struct DoctorEnvelope[\s\S]*ok: bool[\s\S]*findings: Vec<Value>/);
  assert.match(maintenance, /\.issues[\s\S]*\.filter_map\(\|item\|/);
  assert.match(maintenance, /finding_from_value\("config", item, "error"\)/);
  assert.match(maintenance, /report\.config_valid == Some\(true\)/);
  assert.match(maintenance, /report\.doctor_ok == Some\(true\)/);
});

test('BUG-M03 repair stays busy until the post-repair scan completes', () => {
  const center = source('src/components/settings/MaintenanceCenter.tsx');
  const repairStart = center.indexOf('const repair = useCallback');
  const repairEnd = center.indexOf('const copyReport', repairStart);
  const transaction = center.slice(repairStart, repairEnd);
  assert.ok(transaction.indexOf('setReport(await runMaintenanceScan())') >= 0);
  assert.ok(transaction.indexOf('setRepairing(false)') > transaction.indexOf('setReport(await runMaintenanceScan())'));
});

test('BUG-M04 findings and Gateway failures have application-native actions', () => {
  const settings = source('src/pages/SettingsPage.tsx');
  const center = source('src/components/settings/MaintenanceCenter.tsx');
  assert.match(settings, /category === 'mcp' \? 'tools' : category === 'security' \? 'secrets' : 'advanced'/);
  assert.match(settings, /onRecoverGateway=/);
  assert.match(settings, /gatewayManager\.ensureRunning\(\)|ensure_gateway_running/);
  assert.match(center, /onOpenConfig\(category\)/);
  assert.match(center, /onRecoverGateway[\s\S]*gatewayRecovering[\s\S]*检查并恢复 Gateway/);
});

test('BUG-M05 and BUG-M06 raw Doctor execution is not exposed or logged', () => {
  const lib = source('src-tauri/src/lib.rs');
  const maintenance = source('src-tauri/src/commands/maintenance.rs');
  const center = source('src/components/settings/MaintenanceCenter.tsx');
  assert.doesNotMatch(lib, /commands::gateway::run_doctor/);
  assert.match(maintenance, /stdout\(Stdio::null\(\)\)/);
  assert.match(maintenance, /stderr\(Stdio::null\(\)\)/);
  assert.match(maintenance, /configure_background_command\(&mut command\)/);
  assert.doesNotMatch(maintenance, /cmd\.exe|powershell|Command::new\("cmd"/i);
  assert.doesNotMatch(center, /openclaw doctor --fix/i);
});

test('BUG-M07 through BUG-M09 severity, timestamps, and subprocess output fail closed', () => {
  const maintenance = source('src-tauri/src/commands/maintenance.rs');
  assert.match(maintenance, /"error" \| "fatal" \| "critical" => "error"/);
  assert.match(maintenance, /_ => "warning"/);
  assert.match(maintenance, /MAX_STDOUT_BYTES/);
  assert.match(maintenance, /read_limited\(stdout, MAX_STDOUT_BYTES/);
  assert.match(maintenance, /report\.checked_at_ms = chrono::Utc::now\(\)\.timestamp_millis\(\)/);
});
