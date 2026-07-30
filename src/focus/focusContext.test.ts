import assert from 'node:assert/strict';
import test from 'node:test';
import { focusNavigationTarget, projectFocusContext, type FocusContext } from './focusContext';

const base: FocusContext = {
  schemaVersion: 1,
  target: { kind: 'agent-task', id: 'task-1' },
  title: 'Ship focus context',
  detail: 'codex · /repo',
  route: '/agent-run?taskId=task-1',
  focusedAt: 10,
};

test('focus projection keeps identity while taking live status from its authority', () => {
  const projected = projectFocusContext(base, {
    agentTasks: [{ id: 'task-1', title: 'Updated title', status: 'running', agent: 'codex', projectPath: '/repo' }],
  });
  assert.equal(projected?.title, 'Updated title');
  assert.equal(projected?.state, 'running');
  assert.equal(projected?.detail, 'codex · /repo');
});

test('missing focus authority is unavailable rather than silently retargeted', () => {
  const projected = projectFocusContext(base, { agentTasks: [] });
  assert.equal(projected?.state, 'unavailable');
  assert.equal(projected?.target.id, 'task-1');
});

test('all focus target kinds resolve only allowlisted internal navigation', () => {
  assert.equal(focusNavigationTarget(base), '/agent-run?taskId=task-1');
  assert.equal(focusNavigationTarget({ ...base, target: { kind: 'task-brief', id: 'brief-1' }, route: '/briefs?brief=brief-1' }), '/briefs?brief=brief-1');
  assert.equal(focusNavigationTarget({ ...base, target: { kind: 'chat-session', id: 'abc' }, route: '/chat?session=abc' }), '/chat?session=abc');
  assert.equal(focusNavigationTarget({ ...base, route: 'https://example.com' }), null);
  assert.equal(focusNavigationTarget({ ...base, route: '/settings/../secret' }), null);
  assert.equal(focusNavigationTarget({ ...base, route: '/briefs?brief=task-1' }), null);
});

test('chat, worktree, and brief projections use their live authority states', () => {
  const chat = projectFocusContext({
    ...base,
    target: { kind: 'chat-session', id: 'session-1' },
    route: '/chat?session=session-1',
  }, {
    chatSessions: [{ key: 'session-1', label: 'Session', hasActiveRun: true }],
  });
  assert.equal(chat?.state, 'running');

  const worktree = projectFocusContext({
    ...base,
    target: { kind: 'worktree', id: 'worktree-1' },
    route: '/ai-workspace',
  }, {
    worktrees: [{ id: 'worktree-1', path: '/repo', branch: 'main', lifecycle: 'waking' }],
  });
  assert.equal(worktree?.state, 'running');

  const archivedBrief = projectFocusContext({
    ...base,
    target: { kind: 'task-brief', id: 'brief-1' },
    route: '/briefs?brief=brief-1',
  }, {
    taskBriefs: [{ id: 'brief-1', title: 'Brief', status: 'archived', projectPath: '/repo' }],
  });
  assert.equal(archivedBrief?.state, 'unavailable');
});
