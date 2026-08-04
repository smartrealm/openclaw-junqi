import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../styles/index.css', import.meta.url), 'utf8');

test('Tailwind theme colors resolve to valid CSS values in every concrete theme', () => {
  assert.doesNotMatch(css, /<alpha-value>/);

  for (const token of [
    'text',
    'text-secondary',
    'text-muted',
    'text-dim',
    'primary',
    'primary-hover',
    'primary-deep',
    'accent',
    'accent-hover',
    'danger',
    'warning',
    'success',
    'status-running',
    'status-attention',
    'status-idle',
    'status-dormant',
    'status-failed',
    'status-ended',
    'menu-text',
    'menu-text-muted',
  ]) {
    assert.match(css, new RegExp(`--color-aegis-${token}: rgb\\(var\\(--aegis-${token}\\)\\);`));
  }
});

test('semantic color aliases preserve the storage type of their source token', () => {
  assert.match(css, /--color-background: var\(--aegis-bg\);/);
  assert.match(css, /--color-card: var\(--aegis-card\);/);
  assert.match(css, /--color-primary-foreground: var\(--aegis-btn-primary-text\);/);
  assert.match(css, /--color-border: var\(--aegis-border\);/);
  assert.match(css, /--color-input: var\(--aegis-input\);/);
  assert.match(css, /--color-ring: rgb\(var\(--aegis-primary\)\);/);

  assert.doesNotMatch(css, /rgb\(var\(--aegis-(?:bg|card|surface|menu-bg|menu-hover|border|input|btn-primary-text|focus-ring)\)\)/);
  assert.doesNotMatch(
    css,
    /(?:color|background|background-color|border-color):\s*var\(--aegis-(?:text|text-secondary|text-muted|text-dim|primary|primary-hover|primary-deep|accent|accent-hover|danger|warning|success|menu-text|menu-text-muted)\)/,
  );
});

test('legacy palette aliases and elevation utilities follow the active theme', () => {
  assert.match(css, /\[data-theme\][\s\S]*--color-red-400: rgb\(var\(--aegis-danger\)\);/);
  assert.match(css, /\[data-theme\][\s\S]*--color-emerald-500: rgb\(var\(--aegis-success\)\);/);
  assert.match(css, /--shadow-card: var\(--aegis-shadow-card\);/);
  assert.match(css, /--shadow-float: var\(--aegis-shadow-float\);/);
  assert.match(css, /--shadow-popover: var\(--aegis-shadow-popover\);/);
});
