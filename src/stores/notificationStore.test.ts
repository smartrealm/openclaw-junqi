import test from 'node:test';
import assert from 'node:assert/strict';
import { useNotificationStore } from './notificationStore';

test('toast state keeps only the three newest transient messages', () => {
  useNotificationStore.setState({ toasts: [] });
  const { addToast } = useNotificationStore.getState();

  addToast('info', 'one', 'body');
  addToast('info', 'two', 'body');
  addToast('info', 'three', 'body');
  addToast('error', 'four', 'body');

  const state = useNotificationStore.getState();
  assert.deepEqual(state.toasts.map((toast) => toast.title), ['two', 'three', 'four']);
  assert.equal('history' in state, false);
});

test('toast removal affects only the selected transient message', () => {
  useNotificationStore.setState({ toasts: [] });
  const { addToast } = useNotificationStore.getState();
  addToast('info', 'first', 'body');
  addToast('info', 'second', 'body');
  const [first] = useNotificationStore.getState().toasts;
  assert.ok(first);

  useNotificationStore.getState().removeToast(first.id);

  assert.deepEqual(
    useNotificationStore.getState().toasts.map((toast) => toast.title),
    ['second'],
  );
});
