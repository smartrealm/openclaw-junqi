import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('./TabBar.tsx', import.meta.url), 'utf8');
const appLayout = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');
const terminalPage = readFileSync(new URL('../../pages/TerminalPage/index.tsx', import.meta.url), 'utf8');
const terminalChrome = readFileSync(new URL('../../styles/terminal-kooky.css', import.meta.url), 'utf8');

test('Tools opens its catalog before the dedicated terminal route', () => {
  assert.match(tabBar, /id: 'tools'.*path: '\/tools'/);
});

test('terminal uses the same JunQi navigation content and top menu as the main workbench', () => {
  assert.match(appLayout, /usesGlobalSidebar = !isWorkspacePage/);
  assert.doesNotMatch(appLayout, /terminal-kooky-app/);
  assert.match(appLayout, /!isWorkspacePage && <TabBar \/>/);
  assert.match(appLayout, /<NavSidebar \/>/);
  assert.match(appLayout, /sidebarTarget=\{isTerminalPage \? 'terminal' : 'app'\}/);
  assert.match(topBar, /requestTerminalSidebarToggle/);
  assert.match(topBar, /WorkspaceChromeIconButton/);
});

test('terminal uses the shared sidebar chrome without a route-level fixed palette', () => {
  assert.match(terminalPage, /WorkspaceSidebarHeader/);
  assert.doesNotMatch(terminalChrome, /--kooky-|terminal-kooky-topbar|terminal-kooky-app/);
  assert.doesNotMatch(terminalPage, /terminal-kooky-sidebar-brand/);
});

test('terminal remains inside the product shell instead of drill-in back chrome', () => {
  assert.doesNotMatch(appLayout, /showBack=\{showRouteBack\}/);
  assert.doesNotMatch(appLayout, /routeBackFallback = '\/tools'/);
  assert.match(appLayout, /!isWorkspacePage && <TabBar \/>/);
});
