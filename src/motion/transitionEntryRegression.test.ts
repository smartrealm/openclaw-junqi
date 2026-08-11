import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

// SetupPage is a directory of per-step screens; assert against all of them.
const readDir = async (path: string) => {
  const entries = await readdir(new URL(path, import.meta.url));
  const files = await Promise.all(
    entries.filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx')).sort()
      .map((entry) => readFile(new URL(`${path}${entry}`, import.meta.url), 'utf8')),
  );
  return files.join('\n');
};

test('all visible theme selectors use the shared transition service', async () => {
  const files = await Promise.all([
    readDir('../pages/SetupPage/'),
    read('../components/Layout/StatusBar.tsx'),
  ]);
  for (const source of files) {
    assert.match(source, /setThemeWithTransition/);
    assert.doesNotMatch(source, /\.setTheme\(|\bsetTheme\(/);
  }
});

test('dashboard theme control uses the live resolved system theme', async () => {
  const statusBar = await read('../components/Layout/StatusBar.tsx');
  assert.match(statusBar, /useResolvedTheme\(\)/);
  assert.match(statusBar, /nextTheme\(resolvedTheme\)/);
  assert.doesNotMatch(statusBar, /theme\.startsWith\(['"]aegis-/);
});

test('enter-dashboard actions forward their button origin to the transition coordinator', async () => {
  const [page, flow, transition] = await Promise.all([
    readDir('../pages/SetupPage/'),
    readDir('../hooks/useSetupFlow/'),
    read('./workspaceEntryTransition.ts'),
  ]);
  assert.match(page, /flow\.enterDashboard\(event\.currentTarget\)/);
  assert.match(flow, /enterWorkspaceWithTransition\(\(\) => \{[\s\S]*?setSetupComplete\(true\);[\s\S]*?\}, origin\)/);
  assert.match(transition, /circularViewTransition\.run/);
});

test('root transition styles include reduced-motion and no-API fallback', async () => {
  const css = await read('../styles/index.css');
  assert.match(css, /::view-transition-new\(root\)/);
  assert.match(css, /aegis-workspace-entry-fallback/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\*::before,[\s\S]*?animation-duration:\s*0\.01ms\s*!important/);
  assert.match(css, /transition-duration:\s*0\.01ms\s*!important/);
});

test('persistent chrome uses static state indicators instead of decorative pulses', async () => {
  const [topBar, statusBar, sidebar, tabs] = await Promise.all([
    read('../components/Layout/TopBar.tsx'),
    read('../components/Layout/StatusBar.tsx'),
    read('../components/Layout/NavSidebar.tsx'),
    read('../components/Chat/ChatTabs.tsx'),
  ]);

  assert.doesNotMatch(topBar, /status === 'working' && 'bg-aegis-primary animate-pulse'/);
  assert.doesNotMatch(topBar, /status === 'connecting' && 'bg-aegis-warning animate-pulse'/);
  assert.match(statusBar, /<StatusDot[^>]*live=\{false\}/);
  assert.doesNotMatch(statusBar, /reconnectBusy && 'animate-pulse'/);
  assert.doesNotMatch(sidebar, /state === 'running' && 'animate-pulse bg-aegis-success'/);
  assert.doesNotMatch(tabs, /bg-aegis-warning animate-pulse/);
});

test('Gateway recovery preserves page geometry and only uses a brief opacity acknowledgement', async () => {
  const scene = await read('../components/shared/SceneTransition.tsx');

  assert.match(scene, /if \(reducedMotion \|\| recoveryRevision === 0\)/);
  assert.match(scene, /opacity: \[0\.94, 1\]/);
  assert.match(scene, /y: 0/);
  assert.match(scene, /scale: 1/);
  assert.match(scene, /filter: 'saturate\(1\)'/);
  assert.match(scene, /duration: 0\.16/);
  assert.match(scene, /initial=\{false\}/);
  assert.doesNotMatch(scene, /y: \[7, 0\]/);
  assert.doesNotMatch(scene, /scale: \[0\.997, 1\]/);
  assert.doesNotMatch(scene, /saturate\(0\.82\)/);
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
