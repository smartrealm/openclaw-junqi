import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent rows open details directly without duplicated skill accordions', async () => {
  const source = await read('./NavSidebarPanels.tsx');
  const agentsPanel = source.slice(
    source.indexOf('export function AgentsPanel'),
    source.indexOf('export function ToolsPanel'),
  );
  assert.match(agentsPanel, /agents\?agent=/);
  assert.match(agentsPanel, /sidebar\.agentSessionCount/);
  assert.match(agentsPanel, /sidebar\.sharedSkillsHint/);
  assert.doesNotMatch(agentsPanel, /gateway\.getSkills\(expandedAgentId\)/);
  assert.doesNotMatch(agentsPanel, /ChevronDown|ChevronRight|isExpanded/);
  assert.doesNotMatch(agentsPanel, /to: '\/agent-run'/);
  assert.equal(source.match(/to: '\/ai-workspace'/g)?.length, 1);
});
