import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combineUnlisteners, emitTauriEvent, hasTauriEventBridge, subscribeTauriEvent } from './tauriEvents';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')
      ? [path]
      : [];
  });
}

test('plain browser previews do not register Tauri listeners', () => {
  const host = globalThis.window as Window & { __TAURI_INTERNALS__?: unknown };
  const previous = host.__TAURI_INTERNALS__;
  delete host.__TAURI_INTERNALS__;
  try {
    assert.equal(hasTauriEventBridge(), false);
    assert.doesNotThrow(() => subscribeTauriEvent('task-status', () => {}));
    assert.doesNotThrow(() => emitTauriEvent('dynamic-island:ready'));
  } finally {
    host.__TAURI_INTERNALS__ = previous;
  }
});

test('listener cleanup is idempotent and absorbs asynchronous teardown failures', async () => {
  let calls = 0;
  const release = combineUnlisteners([
    (() => {
      calls += 1;
      return Promise.reject(new Error('listener already released'));
    }) as never,
  ]);

  release();
  release();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  assert.equal(calls, 1);
});

test('feature code cannot bypass the lifecycle-safe Tauri event subscriber', () => {
  const allowed = new Set([
    'api/tauri-adapter.ts',
    'components/Terminal/ShellTerminalPanel.tsx',
    'utils/tauriEvents.ts',
  ]);
  const directImports = sourceFiles(srcRoot)
    .map((path) => ({
      path: relative(srcRoot, path),
      source: readFileSync(path, 'utf8'),
    }))
    .filter(({ source }) => /from\s+['"]@tauri-apps\/api\/event['"]/.test(source))
    .map(({ path }) => path)
    .filter((path) => !allowed.has(path));

  assert.deepEqual(directImports, []);
});
