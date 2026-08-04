import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { detachWorkbenchTerminalView } from './workbenchTerminalViewLifecycle';

const source = readFileSync(new URL('./WorkbenchTerminalPane.tsx', import.meta.url), 'utf8');

test('workbench terminal subscribes before create and restores an existing run snapshot', () => {
  const subscribe = source.indexOf('await subscribeWorkbenchPty(');
  const create = source.indexOf('await createWorkbenchPty(');
  assert.ok(subscribe >= 0 && create > subscribe);
  assert.match(source, /if \(created\.completed\)/);
  assert.match(source, /else if \(!created\.created\)/);
  assert.match(source, /tab\.ptyCreatePending === true/);
  assert.match(source, /acknowledgePtyCreate\(tab\.id\)/);
  assert.match(source, /subscription\?\.synchronize\(sequence\)/);
});

test('snapshot resync buffers concurrent output and replays only newer sequences', () => {
  assert.match(source, /if \(resyncing\) bufferedOutput\.push/);
  assert.match(source, /if \(snapshot\.truncated\) terminal\.write\('\[earlier output truncated\]/);
  assert.match(source, /if \(output\.sequence <= sequence\) continue/);
  assert.match(source, /sequence = output\.sequence/);
  assert.match(source, /subscription\?\.synchronize\(nextSequence\)/);
});

test('explicit restart retires the exact old run before replacing identity', () => {
  const start = source.indexOf('const restart = async');
  const restart = source.slice(start, source.indexOf('\n\n  if (!identity) return <', start));
  assert.ok(restart.indexOf('await closeWorkbenchPtyTab(identity)') < restart.indexOf('replacePtyIdentity'));
  assert.match(restart, /workbench:pty:/);
  assert.match(restart, /workbench:run:/);
});

test('workbench terminal detach releases only renderer-owned resources', () => {
  const released: string[] = [];
  detachWorkbenchTerminalView({
    observer: { disconnect: () => released.push('observer') },
    subscription: { dispose: () => released.push('subscription') },
    input: { dispose: () => released.push('input') },
    resize: { dispose: () => released.push('resize') },
    terminal: { dispose: () => released.push('terminal') },
  });

  assert.deepEqual(released, ['observer', 'subscription', 'input', 'resize', 'terminal']);
});
