import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./SkillHubManager.tsx', import.meta.url), 'utf8');

test('skill installs detect conflicts before offering JunQi resolution choices', () => {
  assert.match(source, /strategy: 'detect'/);
  assert.match(source, /resolveInstallConflict\('cancel'\)/);
  assert.match(source, /resolveInstallConflict\('skip'\)/);
  assert.match(source, /resolveInstallConflict\('overwrite'\)/);
  assert.match(source, /Installation conflict/);
});

test('skill removal separates one installation from deleting the hub source', () => {
  assert.match(source, /invoke\('uninstall_skill'/);
  assert.match(source, /invoke<DeleteResult>\('delete_skill'/);
  assert.match(source, /Delete skill/);
});
