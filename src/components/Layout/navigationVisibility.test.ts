import assert from 'node:assert/strict';
import test from 'node:test';
import { filterEnabledNavigationItems } from './navigationVisibility';

test('disabled edition features do not remain in navigation', () => {
  const visible = filterEnabledNavigationItems([
    { id: 'chat', feature: 'chat' as const },
    { id: 'workshop', feature: 'workshop' as const },
    { id: 'memory', feature: 'memory' as const },
  ]);

  assert.deepEqual(visible.map((item) => item.id), ['chat']);
});
