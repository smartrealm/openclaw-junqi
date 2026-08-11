import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadConfigFromFile } from 'vite';

test('Tauri development server binds the same IPv4 loopback family as its default development URL', async () => {
  const loaded = await loadConfigFromFile(
    { command: 'serve', mode: 'development' },
    resolve('vite.config.ts'),
  );

  assert.ok(loaded);
  assert.equal(loaded.config.server.host, '127.0.0.1');
});

test('the pre-React desktop startup surface is accessible and respects reduced motion', async () => {
  const html = await readFile(resolve('index.html'), 'utf8');

  assert.match(html, /class="junqi-bootstrap" role="status" aria-live="polite"/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /\.junqi-bootstrap__indicator \{[\s\S]*?animation: none;/);
});
