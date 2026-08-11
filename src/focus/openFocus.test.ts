import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFocusNavigation } from './openFocus';
import { useChatStore } from '@/stores/chatStore';

const context = (id: string, route: string) => ({
  schemaVersion: 1 as const,
  target: { kind: 'chat-session' as const, id },
  title: id,
  detail: '',
  route,
  focusedAt: 1,
});

test('焦点导航只打开存在的原生会话', () => {
  useChatStore.setState({
    sessions: [{ key: 'session-1', label: 'Session 1' }],
    openTabs: [],
  });
  assert.equal(
    prepareFocusNavigation(context('session-1', '/chat?session=session-1')),
    '/chat?session=session-1',
  );
  assert.equal(useChatStore.getState().activeSessionKey, 'session-1');
  assert.equal(prepareFocusNavigation(context('missing', '/chat?session=missing')), null);
});
