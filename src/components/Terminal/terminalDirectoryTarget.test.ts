import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findShellIdForDirectory,
  terminalDirectoryKey,
} from './terminalDirectoryTarget';

test('terminal directory keys normalize separators and trailing slashes', () => {
  assert.equal(terminalDirectoryKey('/tmp/project///'), '/tmp/project');
  assert.equal(terminalDirectoryKey('C:\\repo\\worktree\\'), 'C:/repo/worktree');
});

test('terminal directory matching can follow Windows case-insensitive paths', () => {
  const shells = [
    { id: 'one', cwd: '/tmp/base' },
    { id: 'two', cwd: 'C:\\Repo\\Worktree' },
  ];

  assert.equal(findShellIdForDirectory(shells, 'c:/repo/worktree/', true), 'two');
  assert.equal(findShellIdForDirectory(shells, 'c:/repo/worktree/', false), null);
  assert.equal(findShellIdForDirectory(shells, '/tmp/missing', false), null);
});
