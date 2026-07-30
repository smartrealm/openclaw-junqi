import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTheme } from './cycle';
import { resolveTheme } from './resolver';
import { AEGIS_THEMES, type AegisTheme } from './types';

test('first dashboard theme cycle leaves the resolved system theme', () => {
  const systemLight = resolveTheme('system', 'aegis-light');
  const systemDark = resolveTheme('system', 'aegis-dark');

  assert.notEqual(nextTheme(systemLight), systemLight);
  assert.notEqual(nextTheme(systemDark), systemDark);
});

test('theme cycle visits every concrete theme exactly once', () => {
  const visited = new Set<string>();
  let current: AegisTheme = 'aegis-dark';

  for (let index = 0; index < AEGIS_THEMES.length; index += 1) {
    visited.add(current);
    current = nextTheme(current);
  }

  assert.deepEqual(visited, new Set(AEGIS_THEMES));
  assert.equal(current, 'aegis-dark');
});
