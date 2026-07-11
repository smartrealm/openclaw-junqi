import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueTerminalCommand, takePendingTerminalCommands } from './terminalCommandQueue';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

test('terminal command queue survives route handoff and drains once', () => {
  const storage = memoryStorage();
  enqueueTerminalCommand({ command: 'make test\n', projectPath: 'C:\\work\\junqi' }, storage);

  assert.deepEqual(takePendingTerminalCommands(storage), [
    { command: 'make test\n', projectPath: 'C:\\work\\junqi' },
  ]);
  assert.deepEqual(takePendingTerminalCommands(storage), []);
});

test('terminal command queue rejects empty and corrupted entries', () => {
  const storage = memoryStorage();
  storage.setItem('junqi:pending-terminal-commands', JSON.stringify([
    null,
    { command: '   ' },
    { command: 'npm test\n', projectPath: '' },
  ]));

  assert.deepEqual(takePendingTerminalCommands(storage), [{ command: 'npm test\n' }]);
});

test('terminal command queue falls back to memory when storage writes fail', () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error('storage unavailable'); };

  enqueueTerminalCommand({ command: 'make -- build\n', projectPath: 'C:\\Work\\JunQi' }, storage);

  assert.deepEqual(takePendingTerminalCommands(storage), [
    { command: 'make -- build\n', projectPath: 'C:\\Work\\JunQi' },
  ]);
});
