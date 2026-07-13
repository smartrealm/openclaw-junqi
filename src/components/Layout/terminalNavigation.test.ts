import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const tabBar = readFileSync(new URL('./TabBar.tsx', import.meta.url), 'utf8');
const appLayout = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const topBar = readFileSync(new URL('./TopBar.tsx', import.meta.url), 'utf8');

test('Tools opens its catalog before the dedicated terminal route', () => {
  assert.match(tabBar, /id: 'tools'.*path: '\/tools'/);
});

test('terminal owns the left content rail while the top-bar toggle remains available', () => {
  assert.match(appLayout, /usesGlobalSidebar = !isWorkspacePage && !isTerminalPage/);
  assert.match(appLayout, /sidebarTarget=\{isTerminalPage \? 'terminal' : 'app'\}/);
  assert.match(topBar, /requestTerminalSidebarToggle/);
});
