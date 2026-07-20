import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const logoSource = readFileSync(new URL('./JunQiLogo.tsx', import.meta.url), 'utf8');
const themeSource = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8');

test('Daxia branch uses only the official Daxia brand assets', () => {
  assert.match(logoSource, /daxia-group-emblem\.png/);
  assert.match(logoSource, /daxia-group-light\.png/);
  assert.match(logoSource, /daxia-group-dark\.png/);
  assert.match(logoSource, /data-brand="daxia-group"/);
  assert.doesNotMatch(logoSource, /junqi-company-logo|junqi-logo-full|junqi-emblem/);
});

test('Daxia lockup follows every app-controlled light and dark theme', () => {
  assert.match(logoSource, /data-theme-role="light"[\s\S]*dark:hidden/);
  assert.match(logoSource, /data-theme-role="dark"[\s\S]*hidden[\s\S]*dark:block/);
  assert.match(themeSource, /@custom-variant dark[\s\S]*aegis-dark[\s\S]*aegis-midnight/);
});
