import assert from 'node:assert/strict';
import test from 'node:test';
import { isGeneratedShellTitle, parseOsc7Cwd, shellStateFromExit } from './shellLifecycle';

test('parseOsc7Cwd accepts local and localhost file URLs', () => {
  assert.equal(parseOsc7Cwd('file:///Users/wei/project'), '/Users/wei/project');
  assert.equal(parseOsc7Cwd('file://localhost/Users/wei/project%20one'), '/Users/wei/project one');
  assert.equal(parseOsc7Cwd('file:///C:/work/junqi'), 'C:/work/junqi');
});

test('parseOsc7Cwd rejects non-file and malformed payloads', () => {
  assert.equal(parseOsc7Cwd('https://example.com/repo'), null);
  assert.equal(parseOsc7Cwd('not a url'), null);
});

test('shell exit state marks transport failures distinctly', () => {
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: 0, reason: 'exited' }), 'exited');
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: null, reason: 'io_error' }), 'failed');
  assert.equal(isGeneratedShellTitle('Terminal 3'), true);
  assert.equal(isGeneratedShellTitle('API terminal'), false);
});
