import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  buildSessionTranscriptEntryParams,
  parseSessionTranscriptBranches,
  SessionTranscriptHistoryClient,
  SessionTranscriptHistoryProtocolUnsupportedError,
} from './SessionTranscriptHistoryClient';
import { OpenClawSessionTargetError } from './OpenClawSessionTarget';

const SESSION_KEY = 'agent:main:main';

test('builds the official sessionKey and entryId transcript mutation shape', () => {
  assert.deepEqual(
    buildSessionTranscriptEntryParams(' agent:main:main ', ' entry-1 ', ' main '),
    { sessionKey: SESSION_KEY, entryId: 'entry-1', agentId: 'main' },
  );
  assert.throws(() => buildSessionTranscriptEntryParams(SESSION_KEY, ' '), /entry id is required/);
  assert.throws(() => buildSessionTranscriptEntryParams(' ', 'entry-1'), OpenClawSessionTargetError);
});

test('validates branch identity and branch shape before UI consumption', () => {
  assert.deepEqual(parseSessionTranscriptBranches({ branches: [{
    leafEntryId: 'entry-2', headline: 'Alternative answer', messageCount: 3, active: false,
  }] }), [{ leafEntryId: 'entry-2', headline: 'Alternative answer', messageCount: 3, active: false }]);
  assert.throws(() => parseSessionTranscriptBranches({ branches: [{ leafEntryId: '', headline: '', messageCount: -1, active: true }] }));
  assert.throws(() => parseSessionTranscriptBranches({ branches: [{
    leafEntryId: 'entry-2', headline: '', messageCount: 0, updatedAt: '', active: true,
  }] }));
});

test('uses the appropriate ordinary and privileged RPC lanes', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; privileged: boolean }> = [];
  const mutationSessions: string[] = [];
  const client = new SessionTranscriptHistoryClient({
    request: async (method, params) => {
      calls.push({ method, params, privileged: false });
      if (method === 'sessions.branches.list') return { branches: [] } as never;
      return { sessionKey: 'agent:main:fork', editorText: 'draft' } as never;
    },
    requestPrivileged: async (method, params) => {
      calls.push({ method, params, privileged: true });
      return method === 'sessions.rewind' ? { editorText: 'restored' } as never : {} as never;
    },
    runMutation: (sessionKey, operation) => {
      mutationSessions.push(sessionKey);
      return operation();
    },
  });

  await client.listBranches(SESSION_KEY, 'main');
  await client.forkAtMessage(SESSION_KEY, 'entry-1');
  await client.rewindToMessage(SESSION_KEY, 'entry-1');
  await client.switchBranch(SESSION_KEY, 'entry-2');

  assert.deepEqual(calls.map(({ method, privileged }) => ({ method, privileged })), [
    { method: 'sessions.branches.list', privileged: false },
    { method: 'sessions.fork', privileged: false },
    { method: 'sessions.rewind', privileged: true },
    { method: 'sessions.branches.switch', privileged: true },
  ]);
  assert.deepEqual(mutationSessions, [SESSION_KEY, SESSION_KEY, SESSION_KEY]);
});

test('does not turn authentication failures into protocol fallback', async () => {
  const client = new SessionTranscriptHistoryClient({
    request: async () => { throw new GatewayRpcError('missing scope: operator.read', 'UNAUTHORIZED'); },
    requestPrivileged: async () => { throw new GatewayRpcError('missing scope: operator.admin', 'UNAUTHORIZED'); },
    runMutation: (_sessionKey, operation) => operation(),
  });
  await assert.rejects(client.listBranches(SESSION_KEY), GatewayRpcError);

  const unsupported = new SessionTranscriptHistoryClient({
    request: async () => { throw new GatewayRpcError('unknown method', 'METHOD_NOT_FOUND'); },
    requestPrivileged: async () => ({} as never),
    runMutation: (_sessionKey, operation) => operation(),
  });
  await assert.rejects(unsupported.listBranches(SESSION_KEY), SessionTranscriptHistoryProtocolUnsupportedError);
});
