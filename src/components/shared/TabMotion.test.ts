import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('shared tab motion uses one reduced-motion-aware indicator contract', async () => {
  const source = await read('./TabMotion.tsx');

  assert.match(source, /useReducedMotion/);
  assert.match(source, /layoutId=\{layoutId\}/);
  assert.match(source, /type: 'spring'/);
  assert.match(source, /duration: 0/);
});

test('surfaces that retain tabs consume the shared indicator', async () => {
  const sources = await Promise.all([
    read('../Layout/TabBar.tsx'),
    read('../../pages/ConfigManager/index.tsx'),
    read('../../pages/SettingsPage.tsx'),
    read('../Chat/ChatTabs.tsx'),
    read('../../pages/SkillsPage/index.tsx'),
    read('../../pages/AgentWorkspace/index.tsx'),
  ]);

  for (const source of sources) {
    assert.match(source, /ActiveTabIndicator/);
  }
});

test('page entrance motion stays on the inner scene and respects reduced motion', async () => {
  const [component, css] = await Promise.all([
    read('./PageTransition.tsx'),
    read('../../styles/index.css'),
  ]);

  assert.match(component, /aegis-page-transition/);
  assert.match(css, /@keyframes aegis-page-enter/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /\.aegis-page-transition\s*\{\s*will-change: auto/);
});

test('workspace tab indicators are scoped per split group', async () => {
  const source = await read('../../pages/AgentWorkspace/index.tsx');

  assert.match(source, /indicatorId=\{`agent-workspace-active-tab-\$\{groupId\}`\}/);
  assert.match(source, /transitionKey=\{activeTab\?\.id \?\? 'empty'\}/);
});
