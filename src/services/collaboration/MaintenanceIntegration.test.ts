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

test('storage switching and official repair use the collaboration maintenance coordinator', () => {
  const storage = source('src/components/setup/StorageSetupGate.tsx');
  const maintenance = source('src/components/settings/MaintenanceCenter.tsx');

  assert.match(
    storage,
    /collaborationMaintenance\.runGuarded\([\s\S]*'storage-migration'[\s\S]*configure_storage/,
  );
  assert.match(storage, /issue\?\.recoveryRequired[\s\S]*collaborationMaintenance\.recover\(\)/);
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
