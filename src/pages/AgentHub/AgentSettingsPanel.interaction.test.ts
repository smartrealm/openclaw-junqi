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

  assert.match(panel, /onOpenWorkspace\(agent\)/);
  assert.doesNotMatch(panel, /<OpenClawAgentWorkspacePanel/);
  assert.match(page, /workspaceView \? \(/);
  assert.match(page, /<OpenClawAgentWorkspacePanel/);
  assert.match(page, /listWorkspace=\{gateway\.listAgentWorkspace\}/);
  assert.doesNotMatch(page, /rootOverride=/);
  assert.match(page, /settingsAgent && 'pe-\[340px\]'/);
});

test('the drawer presents only parsed agent workspace skills', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /agentSkills\.map\(\(skill\)/);
  assert.match(page, /parseAgentWorkspaceSkills\(response\)/);
  assert.doesNotMatch(panel, /useSkillsStore/);
});

test('agent settings presents official bootstrap files through a read-only child panel', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /<AgentBootstrapFilesPanel/);
  assert.match(panel, /getFile=\{onGetAgentBootstrapFile\}/);
  assert.match(page, /gateway\.listAgentBootstrapFiles\(agentId\)/);
  assert.match(page, /onGetAgentBootstrapFile=\{gateway\.getAgentBootstrapFile\}/);
  assert.match(page, /agentBootstrapFileRequestRef\.current\[agentId\] !== requestId/);
  assert.doesNotMatch(panel, /agents\.files\.set/);
});

test('creating an agent persists skill and fallback overrides through a guarded Gateway patch', async () => {
  const page = await read('./index.tsx');

  assert.match(page, /await gateway\.createAgent\(payload\)/);
  assert.match(page, /await persistAgentCreationOverrides\(gateway, payload\.id, creationOverrides\)/);
  assert.match(page, /newAgent\.skillsMode === 'custom'/);
  assert.match(page, /newAgent\.modelMode === 'fallbacks'/);
  assert.match(page, /created\?\.agentId !== payload\.id/);
  assert.doesNotMatch(page, /window\.aegis\.config\.write/);
  assert.doesNotMatch(page, /persistAgentSkillFilter/);
});

test('the add-agent flow supports a one-action base agent and explicit workspace isolation', async () => {
  const page = await read('./index.tsx');

  assert.match(page, /suggestDedicatedGatewayAgentWorkspace/);
  assert.match(page, /newAgent\.workspaceMode === 'dedicated'/);
  assert.match(page, /Create base agent/);
  assert.match(page, /modelMode: 'inherit'/);
  assert.match(page, /Default fallback chain|Fallback chain/);
});

test('agent skill failures have an explicit retry state', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');
  const page = await read('./index.tsx');

  assert.match(panel, /agentSkillsError \?/);
  assert.match(panel, /onClick=\{onRetryAgentSkills\}/);
  assert.match(page, /setAgentSkillErrors/);
  assert.doesNotMatch(page, /catch \{\s*setAgentWorkspaceSkills\([^\n]*\[\]/);
});

test('agent settings edits ordered fallback configuration through config.patch', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');

  assert.match(panel, /fallbackChanged \|\| isModelReferenceObject\(storedModelConfig\)/);
  assert.match(panel, /setModelFallbacks\(/);
  assert.match(panel, /selectedFallbacks/);
  assert.match(panel, /Fallback chain/);
  assert.match(panel, /gateway\.callPrivileged\('config\.patch'/);
  assert.match(panel, /readOpenClawConfigSnapshot\(res\)/);
  assert.match(panel, /agents: \{ list: \[nextEntry\] \}/);
  assert.doesNotMatch(panel, /replacePaths: \['agents\.list'\]/);
  assert.match(panel, /getModelFallbacks\(nextModel\)/);
});

test('agent settings exposes a separate local business profile save path', async () => {
  const panel = await read('./AgentSettingsPanel.tsx');

  assert.match(panel, /data-testid="agent-profile-section"/);
  assert.match(panel, /loadAgentProfile\(agent\.id\)/);
  assert.match(panel, /saveAgentProfile\(\{/);
  assert.match(panel, /profileDomain/);
  assert.match(panel, /profileScope/);
  assert.match(panel, /profileChanged/);
  assert.match(panel, /profileSaveFailed/);
  assert.match(panel, /\{!loadingConfig && \(\s*<AgentProfileSection/s);
});

test('deleting an agent attempts to remove its JunQi-local profile', async () => {
  const page = await read('./index.tsx');

  assert.match(page, /await gateway\.deleteAgent\(agentId\)/);
  assert.match(page, /await deleteAgentProfile\(agentId\)/);
  assert.match(page, /profileCleanupWarningTitle/);
});
