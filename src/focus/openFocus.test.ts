import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareFocusNavigation } from './openFocus';
import { useAgentWorkspaceStore } from '@/stores/agentWorkspaceStore';
import { useChatStore } from '@/stores/chatStore';
import { useTaskBriefStore } from '@/stores/taskBriefStore';
import { useWorkbenchStore } from '@/workbench/store/workbenchStore';
import type { FocusTargetKind } from './focusContext';

const context = (kind: FocusTargetKind, id: string, route: string) => ({
  schemaVersion: 1 as const, target: { kind, id }, title: id, detail: '', route, focusedAt: 1,
});

test('focus navigation opens the exact chat session and task brief', () => {
  useChatStore.setState({
    sessions: [{ key: 'session-1', label: 'Session 1' }],
    openTabs: [],
  });
  assert.equal(
    prepareFocusNavigation(context('chat-session', 'session-1', '/chat?session=session-1')),
    '/chat?session=session-1',
  );
  assert.equal(useChatStore.getState().activeSessionKey, 'session-1');
  assert.equal(prepareFocusNavigation(context('chat-session', 'missing', '/chat?session=missing')), null);

  useTaskBriefStore.setState({
    briefs: [{
      id: 'brief-1',
      title: 'Brief',
      projectPath: '/repo',
      status: 'draft',
      cards: [],
      references: [],
      agent: 'codex',
      permissionMode: 'ask',
      planMode: true,
      launchMode: 'local',
      createdAt: 1,
      updatedAt: 1,
    }],
    selectedBriefId: null,
  });
  assert.equal(
    prepareFocusNavigation(context('task-brief', 'brief-1', '/briefs?brief=brief-1')),
    '/briefs?brief=brief-1',
  );
  assert.equal(useTaskBriefStore.getState().selectedBriefId, 'brief-1');
  assert.equal(prepareFocusNavigation(context('task-brief', 'missing', '/briefs?brief=missing')), null);
});

test('focus navigation activates the exact agent task before returning its route', () => {
  useAgentWorkspaceStore.setState({ tasks: [{ id: 'task-1', projectPath: '/repo', prompt: 'x', agent: 'codex', permissionMode: 'ask', status: 'todo', createdAt: 1, updatedAt: 1 }], selectedTaskId: null, selectedTaskIds: {} });
  assert.equal(prepareFocusNavigation(context('agent-task', 'task-1', '/agent-run?taskId=task-1')), '/agent-run?taskId=task-1');
  assert.equal(useAgentWorkspaceStore.getState().selectedTaskId, 'task-1');
  assert.equal(prepareFocusNavigation(context('agent-task', 'missing', '/agent-run?taskId=missing')), null);
});

test('focus navigation activates the exact worktree and fails closed when missing', () => {
  useWorkbenchStore.setState({ worktrees: { one: { id: 'one', projectId: 'p', repositoryId: 'r', hostId: 'local', hostRevision: 0, path: '/repo', branch: 'main', lifecycle: 'active' } }, activeWorktreeId: null, hydrated: true, writerReady: true });
  assert.equal(prepareFocusNavigation(context('worktree', 'one', '/ai-workspace')), '/ai-workspace');
  assert.equal(useWorkbenchStore.getState().activeWorktreeId, 'one');
  assert.equal(prepareFocusNavigation(context('worktree', 'missing', '/ai-workspace')), null);
});
