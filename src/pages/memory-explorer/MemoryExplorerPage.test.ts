import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('./MemoryExplorerPage.tsx', import.meta.url), 'utf8');
const hook = readFileSync(new URL('./useOpenClawWorkspaceMemories.ts', import.meta.url), 'utf8');

test('memory page only consumes the shared workspace-memory hook', () => {
  assert.match(page, /useOpenClawWorkspaceMemories\(\)/);
  assert.match(page, /useGatewayDataStore/);
  assert.match(page, /searchOpenClawMemory/);
  assert.match(page, /MemoryDiagnosticsPanel/);
  assert.match(page, /refreshOpenClawMemoryDiagnostics/);
  assert.doesNotMatch(page, /doctor\.memory\.remHarness|previewOpenClawMemoryRemHarness/);
  assert.doesNotMatch(page, /window\.aegis/);
  assert.doesNotMatch(page, /\bfetch\(/);
  assert.doesNotMatch(page, /useSettingsStore/);
  assert.doesNotMatch(page, /onDelete|onEdit|MemoryModal/);
});

test('workspace-memory hook owns asynchronous loading and recovery state', () => {
  assert.match(hook, /loadOpenClawWorkspaceMemory\(\)/);
  assert.match(hook, /setError\(reason instanceof Error/);
  assert.match(hook, /void refresh\(\)/);
});
