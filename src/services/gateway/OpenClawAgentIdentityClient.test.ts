import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OpenClawAgentIdentityClient,
  OpenClawAgentIdentityResponseError,
  OpenClawAgentIdentityUnavailableError,
  parseOpenClawAgentIdentity,
} from './OpenClawAgentIdentityClient';

const identityResponse = {
  agentId: 'research',
  name: 'Research Assistant',
  avatar: '/avatar/research',
  avatarSource: 'agents.list.identity.avatar',
  avatarStatus: 'local',
  emoji: 'identity-mark',
  privateWorkspacePath: '/private/workspace',
};

test('OpenClawAgentIdentityClient fences the session-scoped official identity request', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawAgentIdentityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return identityResponse;
    },
  });

  const identity = await client.get({ sessionKey: ' agent:research:main ' });

  assert.deepEqual(calls, [{
    method: 'agent.identity.get',
    params: { sessionKey: 'agent:research:main' },
    connectionId: 'gateway-a',
  }]);
  assert.deepEqual(identity, {
    agentId: 'research',
    name: 'Research Assistant',
    avatar: '/avatar/research',
    avatarSource: 'agents.list.identity.avatar',
    avatarStatus: 'local',
    emoji: 'identity-mark',
  });
  assert.equal('privateWorkspacePath' in identity, false);
});

test('agent identity parsing rejects malformed fields and does not infer a local identity', async () => {
  assert.throws(() => parseOpenClawAgentIdentity({ ...identityResponse, agentId: '' }), OpenClawAgentIdentityResponseError);
  assert.throws(() => parseOpenClawAgentIdentity({ ...identityResponse, avatarStatus: 'cached' }), OpenClawAgentIdentityResponseError);
  assert.throws(() => parseOpenClawAgentIdentity({ ...identityResponse, emoji: 1 }), OpenClawAgentIdentityResponseError);

  const client = new OpenClawAgentIdentityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new Error('must not request'); },
  });
  await assert.rejects(client.get({ sessionKey: '  ' }), OpenClawAgentIdentityResponseError);
});

test('agent.identity.get is sent despite discovery omission and maps a missing method response', async () => {
  let requestSent = false;
  const client = new OpenClawAgentIdentityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => {
      requestSent = true;
      throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
    },
  });

  await assert.rejects(client.get({ sessionKey: 'agent:research:main' }), OpenClawAgentIdentityUnavailableError);
  assert.equal(requestSent, true);
});

test('agent identity discards stale or disconnected responses', async () => {
  let current = true;
  const stale = new OpenClawAgentIdentityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => current,
    requestFenced: async () => {
      current = false;
      return identityResponse;
    },
  });
  const disconnected = new OpenClawAgentIdentityClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(stale.get({ sessionKey: 'agent:research:main' }), OpenClawAgentIdentityUnavailableError);
  await assert.rejects(disconnected.get({ sessionKey: 'agent:research:main' }), OpenClawAgentIdentityUnavailableError);
});
