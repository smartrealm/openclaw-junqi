import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent workspace panel is limited to injected Gateway read operations', async () => {
  const source = await read('./OpenClawAgentWorkspacePanel.tsx');

  assert.match(source, /listWorkspace: \(input: \{ agentId: string; path\?: string \}\) => Promise<AgentWorkspaceListing>/);
  assert.match(source, /getWorkspaceFile: \(agentId: string, path: string\) => Promise<AgentWorkspaceFile>/);
  assert.match(source, /void listWorkspace\(\{ agentId, \.\.\.\(path \? \{ path \} : \{\}\) \}\)/);
  assert.match(source, /void getWorkspaceFile\(agentId, entry\.path\)/);
  assert.doesNotMatch(source, /workspaceFs|FileViewer|invoke\(|write|rename|delete|upload|openPath/);
});

test('agent workspace panel discards superseded listing and preview responses', async () => {
  const source = await read('./OpenClawAgentWorkspacePanel.tsx');

  assert.match(source, /const listRequestRef = useRef\(0\)/);
  assert.match(source, /if \(requestId !== listRequestRef\.current\) return/);
  assert.match(source, /const fileRequestRef = useRef\(0\)/);
  assert.match(source, /if \(requestId === fileRequestRef\.current\) setSelectedFile\(result\)/);
});

test('agent workspace panel previews only Gateway text or base64 image content', async () => {
  const source = await read('./OpenClawAgentWorkspacePanel.tsx');

  assert.match(source, /selectedFile\?\.encoding === 'base64'/);
  assert.match(source, /<img src=\{imageSource\}/);
  assert.match(source, /<pre[^>]*>\{selectedFile\.content\}<\/pre>/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
