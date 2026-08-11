import assert from 'node:assert/strict';
import test from 'node:test';
import { useFocusContextStore } from './focusContextStore';

const validFocus = {
  schemaVersion: 1 as const,
  target: { kind: 'chat-session' as const, id: 'session-1' },
  title: 'Session',
  detail: 'main',
  route: '/chat?session=session-1',
  focusedAt: 1,
};

test('focus store retains a valid focus when a malformed replacement is rejected', () => {
  useFocusContextStore.setState({ focus: validFocus });
  useFocusContextStore.getState().setFocus({
    ...validFocus,
    route: '/settings',
  });
  assert.deepEqual(useFocusContextStore.getState().focus, validFocus);
});
