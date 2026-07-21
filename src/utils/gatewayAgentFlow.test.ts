import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGatewayAgentConfigEntry,
  buildGatewayAgentCreatePayload,
  ensureMainGatewayAgentInList,
  isValidGatewayAgentId,
  normalizeGatewayAgentId,
} from './gatewayAgentFlow';

test('normalizeGatewayAgentId lowercases and hyphenates whitespace', () => {
  assert.equal(normalizeGatewayAgentId(' Research Assistant '), 'research-assistant');
  assert.equal(normalizeGatewayAgentId('Ops\tBot'), 'ops-bot');
});

test('isValidGatewayAgentId follows gateway id constraints', () => {
  assert.equal(isValidGatewayAgentId('research-assistant'), true);
  assert.equal(isValidGatewayAgentId('ops_bot'), true);
  assert.equal(isValidGatewayAgentId('-bad'), false);
  assert.equal(isValidGatewayAgentId('Bad'), false);
  assert.equal(isValidGatewayAgentId('bad space'), false);
});

test('buildGatewayAgentCreatePayload emits the RPC create shape', () => {
  assert.deepEqual(
    buildGatewayAgentCreatePayload({
      id: ' Research Assistant ',
      name: ' Research Assistant ',
      model: ' qwen/qwen3-coder-plus ',
      workspace: '',
      inheritWorkspace: true,
    }, '/tmp/openclaw-workspace'),
    {
      id: 'research-assistant',
      name: 'Research Assistant',
      model: 'qwen/qwen3-coder-plus',
      workspace: '/tmp/openclaw-workspace',
    },
  );
});

test('buildGatewayAgentCreatePayload uses the default workspace required by OpenClaw', () => {
  assert.deepEqual(
    buildGatewayAgentCreatePayload({
      id: 'worker',
      workspace: '',
    }, '/srv/openclaw/workspace'),
    {
      id: 'worker',
      workspace: '/srv/openclaw/workspace',
    },
  );
});

test('buildGatewayAgentConfigEntry emits the config agents.list shape', () => {
  assert.deepEqual(
    buildGatewayAgentConfigEntry({
      id: 'Code Bot',
      name: 'Code Bot',
      model: 'anthropic/claude-sonnet-4.5',
    }),
    {
      id: 'code-bot',
      name: 'Code Bot',
      model: { primary: 'anthropic/claude-sonnet-4.5' },
      workspace: undefined,
    },
  );
});

test('ensureMainGatewayAgentInList keeps main first and filters invalid empty ids', () => {
  assert.deepEqual(
    ensureMainGatewayAgentInList(
      [{ id: 'ops' }, { id: '' }, { id: 'main', name: 'Custom Main' }, { id: 'research' }],
      { id: 'main', name: 'Main Agent' },
    ),
    [
      { id: 'main', name: 'Custom Main' },
      { id: 'ops' },
      { id: 'research' },
    ],
  );
});
