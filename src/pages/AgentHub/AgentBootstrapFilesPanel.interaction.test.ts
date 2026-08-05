import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('bootstrap file panel receives only a read operation and never exposes a write action', async () => {
  const source = await read('./AgentBootstrapFilesPanel.tsx');

  assert.match(source, /getFile: \(agentId: string, name: string\) => Promise<OpenClawAgentBootstrapFileGet>/);
  assert.match(source, /void getFile\(agentId, file\.name\)/);
  assert.doesNotMatch(source, /agents\.files\.set|workspaceFs|invoke\(|onSave|writeFile|createFile|deleteFile|uploadFile|openPath/);
});

test('bootstrap file panel preserves expected absence and fences superseded file previews', async () => {
  const source = await read('./AgentBootstrapFilesPanel.tsx');

  assert.match(source, /file\.expectedAbsent/);
  assert.match(source, /const requestIdRef = useRef\(0\)/);
  assert.match(source, /if \(nextRequestId === requestIdRef\.current\) setSelected\(result\.file\)/);
  assert.match(source, /textFilePreviewContent\(selected\.name, selected\.content\)/);
  assert.match(source, /<FilePreviewSurface/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
});
