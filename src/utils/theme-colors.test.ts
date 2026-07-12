import test from 'node:test';
import assert from 'node:assert/strict';
import { dataColorVar, themeColorVar } from './theme-colors';

test('themeColorVar returns live CSS token references', () => {
  assert.equal(themeColorVar('primary'), 'rgb(var(--aegis-primary))');
  assert.equal(themeColorVar('warning', 0.1), 'rgb(var(--aegis-warning) / 0.1)');
});

test('dataColorVar preserves the existing zero-based palette index', () => {
  assert.equal(dataColorVar(0), 'var(--aegis-data-1)');
  assert.equal(dataColorVar(9), 'var(--aegis-data-10)');
});
