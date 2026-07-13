import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent rows keep edit out of the repeated collapsed-row actions', async () => {
  const source = await read('./NavSidebarPanels.tsx');
  const agentsPanel = source.slice(
    source.indexOf('export function AgentsPanel'),
    source.indexOf('export function ToolsPanel'),
  );
  const expandedPanel = agentsPanel.slice(agentsPanel.indexOf('{isExpanded &&'));

  assert.match(expandedPanel, /sidebar\.editAgent/);
  assert.match(expandedPanel, /agents\?agent=/);
  assert.doesNotMatch(agentsPanel.slice(0, agentsPanel.indexOf('{isExpanded &&')), /agents\?agent=/);
});
