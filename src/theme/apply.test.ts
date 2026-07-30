import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNativeThemeTarget } from './apply';

test('system theme leaves native window appearance under operating-system control', () => {
  assert.equal(resolveNativeThemeTarget('aegis-light', 'system'), null);
  assert.equal(resolveNativeThemeTarget('aegis-dark', 'system'), null);
});

test('manual themes explicitly align native window chrome with the app surface', () => {
  assert.equal(resolveNativeThemeTarget('aegis-light', 'aegis-light'), 'light');
  assert.equal(resolveNativeThemeTarget('aegis-eyecare', 'aegis-eyecare'), 'light');
  assert.equal(resolveNativeThemeTarget('aegis-dark', 'aegis-dark'), 'dark');
  assert.equal(resolveNativeThemeTarget('aegis-midnight', 'aegis-midnight'), 'dark');
});
