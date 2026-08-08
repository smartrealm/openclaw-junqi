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
  assert.match(source, /uninstallSkillHubSkill\(/);
  assert.match(source, /deleteSkillHubSkill\(/);
  assert.doesNotMatch(source, /\binvoke\(/);
  assert.match(source, /Delete skill/);
});

test('local Skill Hub stays visibly separate from Gateway-managed skills', () => {
  assert.match(source, /localLinkManagerBoundary/);
  assert.match(source, /JunQi-local|JunQi 本地增强/);
  assert.match(source, /does not read|不读取|Gateway/);
});
