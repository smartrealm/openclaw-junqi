import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('user-facing skill management actions open the complete skills center', () => {
  const userFacingSources = [
    read('../components/Layout/NavSidebarPanels.tsx'),
    read('../components/shared/WelcomePage.tsx'),
    read('./AgentHub/index.tsx'),
  ];

  for (const source of userFacingSources) {
    assert.doesNotMatch(source, /navigate\('\/skill-hub'\)/);
    assert.match(source, /navigate\('\/skills'\)/);
  }
});

test('advanced project skill-link management remains available as a compatibility route', () => {
  const routes = read('../AppRouteTree.tsx');

  assert.match(routes, /path="\/skills"/);
  assert.match(routes, /path="\/skill-hub"/);
  assert.match(routes, /<SkillHubManagerPage \/>/);
});
