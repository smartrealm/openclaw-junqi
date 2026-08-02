import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../../stores/skillsStore.ts', import.meta.url), 'utf8');

test('skills surfaces use the shared OpenClaw runtime instead of adapter fallbacks', () => {
  assert.match(page, /openClawSkillsRuntime/);
  assert.doesNotMatch(page, /window\.aegis/);
  assert.doesNotMatch(page, /gateway\.call/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.match(store, /openClawSkillsRuntime/);
  assert.doesNotMatch(store, /gateway\.call/);
});
