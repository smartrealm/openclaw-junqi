import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./openclawWorkspaceMemory.ts', import.meta.url), 'utf8');

test('workspace memory is restricted to documented OpenClaw workspace locations', () => {
  assert.match(source, /PRIMARY_MEMORY_FILE_NAME = 'MEMORY\.md'/);
  assert.match(source, /MEMORY_DIRECTORY_NAME = 'memory'/);
  assert.match(source, /getWorkspacePath\(\)/);
  assert.match(source, /readDir\(workspacePath, workspacePath\)/);
  assert.match(source, /readFilePreview\(entry\.path, workspacePath\)/);
  assert.doesNotMatch(source, /window\.aegis/);
  assert.doesNotMatch(source, /fetch\(/);
});

test('workspace memory bounds recursive journal traversal', () => {
  assert.match(source, /MAX_MEMORY_FILES = 200/);
  assert.match(source, /MAX_MEMORY_DIRECTORY_DEPTH = 3/);
  assert.match(source, /collected\.length >= MAX_MEMORY_FILES/);
});
