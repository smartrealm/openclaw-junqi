import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTerminalGitDiffIndex,
  clampTerminalSidebarWidth,
  nextTerminalSidebarMode,
  resizeTerminalSidebarWidth,
  terminalWorkspacePathKey,
} from './terminalWorkspaceTree';

test('file diff index aggregates collapsed POSIX directories', () => {
  const index = buildTerminalGitDiffIndex('/repo', [
    { path: '/repo/src/app.ts', insertions: 4, deletions: 1 },
    { path: '/repo/src/lib/util.ts', insertions: 2, deletions: 3 },
    { path: '/other/ignored.ts', insertions: 99, deletions: 99 },
  ]);

  assert.deepEqual(index.files.get('/repo/src/app.ts'), { insertions: 4, deletions: 1 });
  assert.deepEqual(index.directories.get('/repo/src'), { insertions: 6, deletions: 4 });
  assert.deepEqual(index.directories.get('/repo/src/lib'), { insertions: 2, deletions: 3 });
  assert.equal(index.directories.has('/repo'), false);
});

test('file diff index compares Windows drive paths case-insensitively', () => {
  const index = buildTerminalGitDiffIndex('C:\\Work\\JunQi', [
    { path: 'c:\\work\\junqi\\src\\main.ts', insertions: 1, deletions: 0 },
  ]);

  assert.deepEqual(index.files.get('c:/work/junqi/src/main.ts'), { insertions: 1, deletions: 0 });
  assert.deepEqual(index.directories.get('c:/work/junqi/src'), { insertions: 1, deletions: 0 });
  assert.equal(terminalWorkspacePathKey('C:\\Work\\JunQi\\'), 'c:/work/junqi');
});

test('file diff index matches Windows canonical extended-length paths', () => {
  const index = buildTerminalGitDiffIndex('C:\\Work\\JunQi', [
    { path: '\\\\?\\C:\\Work\\JunQi\\src\\main.ts', insertions: 7, deletions: 3 },
  ]);

  assert.deepEqual(index.files.get(terminalWorkspacePathKey('c:\\work\\junqi\\src\\main.ts')), {
    insertions: 7,
    deletions: 3,
  });
  assert.equal(
    terminalWorkspacePathKey('\\\\?\\UNC\\Server\\Share\\Repo'),
    '//server/share/repo',
  );
});

test('sidebar width is stable, integral, and bounded', () => {
  assert.equal(clampTerminalSidebarWidth(120), 220);
  assert.equal(clampTerminalSidebarWidth(321.7), 322);
  assert.equal(clampTerminalSidebarWidth(900), 480);
  assert.equal(clampTerminalSidebarWidth(Number.NaN), 220);
});

test('sidebar resize follows its physical edge in LTR and RTL layouts', () => {
  assert.equal(resizeTerminalSidebarWidth(300, 25, 'ltr'), 325);
  assert.equal(resizeTerminalSidebarWidth(300, -25, 'rtl'), 325);
  assert.equal(resizeTerminalSidebarWidth(300, 25, 'rtl'), 275);
});

test('path keys preserve valid POSIX whitespace', () => {
  assert.equal(terminalWorkspacePathKey('/repo with space/dir '), '/repo with space/dir ');
});

test('sidebar visibility follows Kooky full, compact, hidden order', () => {
  assert.equal(nextTerminalSidebarMode('full'), 'compact');
  assert.equal(nextTerminalSidebarMode('compact'), 'hidden');
  assert.equal(nextTerminalSidebarMode('hidden'), 'full');
});
