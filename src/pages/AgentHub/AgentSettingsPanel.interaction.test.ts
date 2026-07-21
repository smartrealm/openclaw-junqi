import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('channels are collapsed whenever a different agent is opened', async () => {
  const source = await read('./AgentSettingsPanel.tsx');

  assert.match(source, /useState\(false\).*channelsExpanded|channelsExpanded.*useState\(false\)/s);
  assert.match(source, /setChannelsExpanded\(false\)/);
  assert.match(source, /aria-expanded=\{channelsExpanded\}/);
  assert.match(source, /\{channelsExpanded && <div/);
});

test('workspace opens in the parent content area instead of inside the drawer', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /onOpenWorkspace\(agent, trimmedWorkspace \|\| undefined\)/);
  assert.doesNotMatch(panel, /<WorkspacePanel/);
  assert.match(page, /workspaceView \? \(/);
  assert.match(page, /<WorkspacePanel/);
  assert.match(page, /settingsAgent && 'pe-\[340px\]'/);
});

test('the drawer presents only parsed agent workspace skills', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /agentSkills\.map\(\(skill\)/);
  assert.match(page, /parseAgentWorkspaceSkills\(response\)/);
  assert.doesNotMatch(panel, /useSkillsStore/);
});

test('creating an agent persists selected skills as the native allowlist', async () => {
  const page = await read('./index.tsx');

  assert.match(page, /await gateway\.createAgent\(payload\)/);
  assert.match(page, /await persistAgentSkillFilter\(payload\.id, newAgentSkillKeys\)/);
  assert.match(page, /created\?\.agentId !== payload\.id/);
  assert.doesNotMatch(page, /gateway\.createAgent\([^)]*skills/);
});

test('agent skill failures have an explicit retry state', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /agentSkillsError \?/);
  assert.match(panel, /onClick=\{onRetryAgentSkills\}/);
  assert.match(page, /setAgentSkillErrors/);
  assert.doesNotMatch(page, /catch \{\s*setAgentWorkspaceSkills\([^\n]*\[\]/);
});
