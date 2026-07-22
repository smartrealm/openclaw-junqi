import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

test('OpenClaw update enters collaboration maintenance before invoking the updater', () => {
  const hook = source('src/hooks/useOpenclawUpdate.ts');
  const begin = hook.indexOf('await beginOpenclawUpdateMaintenance()');
  const update = hook.indexOf('await updateOpenclaw()', begin);
  const finish = hook.indexOf('await finishOpenclawUpdateMaintenance(maintenance)', update);

  assert.ok(begin >= 0);
  assert.ok(update > begin);
  assert.ok(finish > update);
  assert.match(hook, /failOpenclawUpdateMaintenance/);
  assert.match(hook, /recoverOpenclawUpdateMaintenance/);
});

test('storage switching uses the native Gateway transaction while official repair uses collaboration maintenance', () => {
  const storage = source('src/components/setup/StorageSetupGate.tsx');
  const maintenance = source('src/components/settings/MaintenanceCenter.tsx');
  const storageCommand = source('src-tauri/src/commands/storage.rs');

  assert.doesNotMatch(storage, /useCollaborationMaintenance|collaborationMaintenance/);
  assert.match(storage, /invoke<StorageConfigureResult>\('configure_storage'/);
  assert.match(storage, /appendSetupLog\([\s\S]*step: 'storage'/);
  assert.doesNotMatch(storage, /setError\(String\(cause\)\)/);
  assert.match(storageCommand, /pub async fn configure_storage[\s\S]*operation_gate\.lock_owned\(\)/);
  assert.match(storageCommand, /stop_all_locked_with_compensation/);
  for (const locale of ['zh', 'zh-TW', 'en', 'ar']) {
    const messages = source(`src/locales/${locale}.json`);
    for (const key of [
      'storage.logSaving',
      'storage.logSaved',
      'storage.logFailed',
      'storage.logLoadFailed',
      'storage.logRecoveryFailed',
      'storage.unknownError',
    ]) {
      assert.match(messages, new RegExp(`"${key}"\\s*:\\s*"[^"\\n]+"`));
    }
  }
  assert.match(
    maintenance,
    /collaborationMaintenance\.runGuarded\([\s\S]*'openclaw-repair'[\s\S]*runOpenClawRepair/,
  );
  assert.match(maintenance, /collaborationMaintenance\.status\?\.active/);
  assert.match(maintenance, /collaborationMaintenance\.recover\(\)/);
});

test('the maintenance coordinator has no implicit run cancellation path', () => {
  const coordinator = source('src/services/collaboration/MaintenanceCoordinator.ts');

  assert.doesNotMatch(coordinator, /run\.cancel|workItem\.cancel|cancelRun|silentCancel/);
  assert.match(coordinator, /activeRuns\.length > 0/);
  assert.match(coordinator, /healthVerified: true/);
  assert.match(coordinator, /INSTANCE_CHANGED/);
  assert.match(coordinator, /DATABASE_INTEGRITY_FAILED/);
});
