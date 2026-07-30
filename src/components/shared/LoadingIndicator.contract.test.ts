import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

const srcRoot = fileURLToPath(new URL('../../', import.meta.url));

function productionFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (
        ['.ts', '.tsx'].includes(extname(entry.name))
        && !entry.name.includes('.test.')
      ) {
        files.push(path);
      }
    }
  };
  walk(root);
  return files;
}

test('BUG-FCA-06 production loading states do not render Loader2', () => {
  const offenders = productionFiles(srcRoot)
    .filter((path) => /\bLoader2\b/.test(readFileSync(path, 'utf8')))
    .map((path) => relative(srcRoot, path));

  assert.deepEqual(
    offenders,
    [],
    `Use LoadingIndicator or Button loading instead of Loader2: ${offenders.join(', ')}`,
  );
});

test('BUG-FCA-04 lifecycle spinners consume the canonical running tone', () => {
  const badge = readFileSync(new URL('./StatusBadge.tsx', import.meta.url), 'utf8');
  assert.match(
    badge,
    /<LoadingIndicator size=\{glyphSize\} className="shrink-0" style=\{\{ color \}\}/,
    'StatusBadge must pass the resolved lifecycle tone to its running spinner',
  );
});

test('BUG-FCA-06 shared indicator owns accessibility and reduced-motion behavior', () => {
  const component = readFileSync(new URL('./LoadingIndicator.tsx', import.meta.url), 'utf8');
  const stylesheet = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8');

  assert.match(component, /role: 'status'/);
  assert.match(component, /'aria-live': 'polite'/);
  assert.match(component, /'aria-hidden': true/);
  assert.match(stylesheet, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(stylesheet, /\.aegis-loading-indicator__spinner/);
  assert.match(stylesheet, /\.aegis-loading-indicator__dots/);
});
