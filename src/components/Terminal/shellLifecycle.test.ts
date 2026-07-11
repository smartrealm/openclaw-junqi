import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceShellLaunchPath,
  isGeneratedShellTitle,
  parseOsc7Cwd,
  shellStateFromExit,
} from './shellLifecycle';

test('parseOsc7Cwd accepts local and localhost file URLs', () => {
  assert.equal(parseOsc7Cwd('file:///Users/wei/project'), '/Users/wei/project');
  assert.equal(parseOsc7Cwd('file://localhost/Users/wei/project%20one'), '/Users/wei/project one');
  assert.equal(parseOsc7Cwd('file://my-mac/Users/wei/project'), '/Users/wei/project');
  assert.equal(parseOsc7Cwd('file:///C:/work/junqi'), 'C:/work/junqi');
  assert.equal(
    parseOsc7Cwd('file://server/share/project%20one', 'windows'),
    '//server/share/project one',
  );
  assert.equal(
    parseOsc7Cwd('file://localhost/C%3A/work/100%2520real%23one%3Ftwo'),
    'C:/work/100%20real#one?two',
  );
  assert.equal(parseOsc7Cwd('file://localhost/tmp/%E9%A1%B9%E7%9B%AE%20one'), '/tmp/\u9879\u76ee one');
});

test('parseOsc7Cwd rejects non-file and malformed payloads', () => {
  assert.equal(parseOsc7Cwd('https://example.com/repo'), null);
  assert.equal(parseOsc7Cwd('not a url'), null);
  assert.equal(parseOsc7Cwd('file://localhost/tmp/bad%00path'), null);
});

test('shell exit state marks transport failures distinctly', () => {
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: 0, reason: 'exited' }), 'exited');
  assert.equal(shellStateFromExit({ shell_id: 'a', run_id: 'r', exit_code: null, reason: 'io_error' }), 'failed');
  assert.equal(isGeneratedShellTitle('Terminal 3'), true);
  assert.equal(isGeneratedShellTitle('API terminal'), false);
});

test('OSC cwd changes do not replace a running shell launch path', () => {
  const initial = advanceShellLaunchPath(null, '/workspace', 0);
  const afterCwdChange = advanceShellLaunchPath(initial, '/workspace/packages/app', 0);
  const afterRestart = advanceShellLaunchPath(afterCwdChange, '/workspace/packages/app', 1);

  assert.equal(afterCwdChange, initial);
  assert.equal(afterCwdChange.path, '/workspace');
  assert.deepEqual(afterRestart, { restartNonce: 1, path: '/workspace/packages/app' });
});
