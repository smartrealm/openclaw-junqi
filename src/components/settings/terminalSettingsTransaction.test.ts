import assert from 'node:assert/strict';
import test from 'node:test';
import { commitTerminalSettingsReset } from './terminalSettingsTransaction';

test('terminal defaults are committed locally only after native persistence succeeds', async () => {
  const order: string[] = [];
  await commitTerminalSettingsReset(
    async () => { order.push('native'); },
    () => { order.push('local'); },
  );
  assert.deepEqual(order, ['native', 'local']);
});

test('terminal defaults remain unchanged locally when native persistence fails', async () => {
  let localReset = false;
  await assert.rejects(
    commitTerminalSettingsReset(
      async () => { throw new Error('settings disk unavailable'); },
      () => { localReset = true; },
    ),
    /settings disk unavailable/,
  );
  assert.equal(localReset, false);
});
