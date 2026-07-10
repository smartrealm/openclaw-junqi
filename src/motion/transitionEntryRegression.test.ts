import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('all visible theme selectors use the shared transition service', async () => {
  const files = await Promise.all([
    read('../pages/SetupPage.tsx'),
    read('../components/shared/AppSettingsDialog.tsx'),
    read('../components/Layout/StatusBar.tsx'),
  ]);
  for (const source of files) {
    assert.match(source, /setThemeWithTransition/);
    assert.doesNotMatch(source, /\.setTheme\(|\bsetTheme\(/);
  }
});

test('enter-workspace actions forward their button origin to the transition coordinator', async () => {
  const [page, flow, transition] = await Promise.all([
    read('../pages/SetupPage.tsx'),
    read('../hooks/useSetupFlow.ts'),
    read('./workspaceEntryTransition.ts'),
  ]);
  assert.match(page, /flow\.enterWorkspace\(event\.currentTarget\)/);
  assert.match(flow, /enterWorkspaceWithTransition\(\(\) => setSetupComplete\(true\), origin\)/);
  assert.match(transition, /circularViewTransition\.run/);
});

test('root transition styles include reduced-motion and no-API fallback', async () => {
  const css = await read('../styles/index.css');
  assert.match(css, /::view-transition-new\(root\)/);
  assert.match(css, /aegis-workspace-entry-fallback/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
