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

test('theme fallback swaps colors without moving the application root', async () => {
  const [transition, css] = await Promise.all([
    read('./themeTransition.ts'),
    read('../styles/index.css'),
  ]);
  assert.doesNotMatch(transition, /fallbackClass:\s*['"]aegis-theme-transition-fallback/);
  assert.doesNotMatch(css, /aegis-theme-transition-fallback/);
});

test('theme switching does not restart mounted component animations', async () => {
  const css = await read('../styles/index.css');
  const rule = css.match(/html\.theme-switching,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? '';
  assert.match(rule, /transition:\s*none\s*!important/);
  assert.doesNotMatch(rule, /animation:\s*none\s*!important/);
});

test('dashboard theme colors stay CSS-driven without replaying chart animations', async () => {
  const sources = await Promise.all([
    read('../pages/Dashboard/index.tsx'),
    read('../pages/Dashboard/components.tsx'),
    read('../pages/Dashboard/CostChart.tsx'),
  ]);
  for (const source of sources) {
    assert.doesNotMatch(source, /\bthemeHex\(|\bthemeAlpha\(|\bdataColor\(/);
  }
  assert.equal(sources[2].match(/isAnimationActive=\{false\}/g)?.length, 4);
});

test('root theme subscription is isolated from the application state owner', async () => {
  const [app, layout, sidebar] = await Promise.all([
    read('../App.tsx'),
    read('../components/Layout/AppLayout.tsx'),
    read('../components/Layout/NavSidebar.tsx'),
  ]);
  assert.match(app, /function ThemeRuntime\(\)[\s\S]*useTheme\(\);[\s\S]*return null;/);
  const appBody = app.slice(app.indexOf('export default function App()'));
  assert.doesNotMatch(appBody, /^\s*useTheme\(\);/m);
  assert.match(layout, /useSettingsStore\(\(s\) => s\.language\)/);
  assert.match(sidebar, /useSettingsStore\(\(s\) => s\.sidebarMode\)/);
  assert.doesNotMatch(layout, /useSettingsStore\(\)/);
  assert.doesNotMatch(sidebar, /useSettingsStore\(\)/);
});
