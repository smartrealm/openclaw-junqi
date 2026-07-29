import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../../components/Layout/AppLayout.tsx', import.meta.url), 'utf8');

 test('AI workspace remains inside the JunQi product shell', () => {
  assert.match(layout, /usesGlobalSidebar = !isWorkspacePage/);
  assert.match(layout, /globalSidebarPresentation = isAgentWorkspacePage \? 'terminal-rail' : 'default'/);
  assert.match(layout, /!isWorkspacePage && <TabBar \/>/);
});

test('AI workspace exposes worktree, unified tab and right-sidebar regions', () => {
  assert.match(source, /data-testid="junqi-ai-workbench"/);
  assert.match(source, /<WorktreeSidebar/);
  assert.match(source, /<TabGroupLayout/);
  assert.match(source, /splitStoreGroup/);
  assert.match(source, /<WorkbenchTabBar/);
  assert.match(source, /<WorkbenchContent/);
  assert.match(source, /<RightSidebar/);
});

test('TopBar and workspace share the isolated agent sidebar channel', () => {
  assert.match(source, /readAgentWorkspaceSidebarMode/);
  assert.match(source, /AGENT_WORKSPACE_SIDEBAR_TOGGLE_EVENT/);
  assert.match(source, /publishAgentWorkspaceSidebarMode\(sidebarMode\)/);
  assert.match(source, /mode === 'full' \? 'compact' : mode === 'compact' \? 'hidden' : 'full'/);
});

test('AI workspace does not mount or navigate through the independent terminal', () => {
  assert.doesNotMatch(source, /ShellTerminalPanel/);
  assert.doesNotMatch(source, /workspaceStore/);
  assert.doesNotMatch(source, /terminalPtyHandoff/);
  assert.doesNotMatch(source, /navigate\(['"]\/terminal/);
});

test('prototype has no browser-only preview entry or Tauri storage bypass', () => {
  assert.doesNotMatch(source, /preview-workbench/);
  assert.doesNotMatch(source, /__TAURI_INTERNALS__/);
  assert.doesNotMatch(source, /无法读取存储配置/);
});
