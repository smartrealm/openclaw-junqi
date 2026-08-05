import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawToolsEffectiveClient,
  OpenClawToolsEffectiveResponseError,
  parseOpenClawToolsEffectiveResult,
} from './OpenClawToolsEffectiveClient';

test('sends the native session-scoped request and decodes effective groups and notices', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawToolsEffectiveClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return {
      agentId: 'main',
      profile: 'coding',
      groups: [{
        id: 'core',
        label: 'Core tools',
        source: 'core',
        tools: [{
          id: 'read',
          label: 'Read',
          description: 'Read a file',
          rawDescription: 'Read a file from the workspace',
          source: 'core',
          risk: 'low',
          tags: ['filesystem'],
        }],
      }, {
        id: 'mcp',
        label: 'MCP tools',
        source: 'mcp',
        tools: [{
          id: 'github__issue',
          label: 'Issue',
          description: 'Create an issue',
          rawDescription: 'Create an issue',
          source: 'mcp',
          mcpServer: 'github',
          mcpToolName: 'issue',
          deniedBySession: true,
        }],
      }],
      notices: [{
        id: 'mcp-not-yet-connected',
        severity: 'info',
        message: 'MCP tools are not available yet.',
        servers: ['github'],
      }],
    } as T;
  });

  assert.deepEqual(await client.get({ sessionKey: ' agent:main:main ' }), {
    agentId: 'main',
    profile: 'coding',
    groups: [{
      id: 'core',
      label: 'Core tools',
      source: 'core',
      tools: [{
        id: 'read',
        label: 'Read',
        description: 'Read a file',
        rawDescription: 'Read a file from the workspace',
        source: 'core',
        risk: 'low',
        tags: ['filesystem'],
      }],
    }, {
      id: 'mcp',
      label: 'MCP tools',
      source: 'mcp',
      tools: [{
        id: 'github__issue',
        label: 'Issue',
        description: 'Create an issue',
        rawDescription: 'Create an issue',
        source: 'mcp',
        mcpServer: 'github',
        mcpToolName: 'issue',
        deniedBySession: true,
      }],
    }],
    notices: [{
      id: 'mcp-not-yet-connected',
      severity: 'info',
      message: 'MCP tools are not available yet.',
      servers: ['github'],
    }],
  });
  assert.deepEqual(calls, [{
    method: 'tools.effective',
    params: { sessionKey: 'agent:main:main' },
  }]);
});

test('preserves additive fields but rejects invalid identity, source, denial and notice data', () => {
  assert.deepEqual(parseOpenClawToolsEffectiveResult({
    agentId: 'main',
    profile: 'full',
    groups: [],
    futureField: true,
  }), {
    agentId: 'main',
    profile: 'full',
    groups: [],
  });

  for (const value of [
    { agentId: '', profile: 'full', groups: [] },
    { agentId: 'main', profile: 'full', groups: [{ id: 'unknown', label: 'x', source: 'core', tools: [] }] },
    { agentId: 'main', profile: 'full', groups: [{ id: 'core', label: 'x', source: 'core', tools: [{ id: 'read', label: 'Read', description: '', rawDescription: '', source: 'core', deniedBySession: false }] }] },
    { agentId: 'main', profile: 'full', groups: [], notices: [{ id: 'n', severity: 'error', message: 'bad' }] },
  ]) {
    assert.throws(() => parseOpenClawToolsEffectiveResult(value), OpenClawToolsEffectiveResponseError);
  }
});

test('rejects missing session keys and malformed effective results', async () => {
  const client = new OpenClawToolsEffectiveClient(async <T>(): Promise<T> => ({}) as T);
  await assert.rejects(client.get({ sessionKey: ' ' }));
  await assert.rejects(client.get({ sessionKey: 'agent:main:main', agentId: ' ' }));
  await assert.rejects(client.get({ sessionKey: 'agent:main:main' }), OpenClawToolsEffectiveResponseError);
});
