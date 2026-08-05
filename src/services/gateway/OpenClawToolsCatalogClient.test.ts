import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawToolsCatalogClient,
  OpenClawToolsCatalogResponseError,
  parseOpenClawToolsCatalogResult,
} from './OpenClawToolsCatalogClient';

test('sends the native agent-scoped request and decodes profiles, groups and metadata', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawToolsCatalogClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return {
      agentId: 'main',
      profiles: [{ id: 'coding', label: 'Coding' }],
      groups: [{
        id: 'core',
        label: 'Core tools',
        source: 'core',
        tools: [{
          id: 'read',
          label: 'Read',
          description: 'Read a file',
          source: 'core',
          risk: 'low',
          tags: ['filesystem'],
          defaultProfiles: ['minimal', 'coding'],
        }],
      }, {
        id: 'plugin:voice',
        label: 'Voice',
        source: 'plugin',
        pluginId: 'voice-plugin',
        tools: [{
          id: 'speak',
          label: 'Speak',
          description: '',
          source: 'plugin',
          pluginId: 'voice-plugin',
          optional: true,
          defaultProfiles: [],
        }],
      }],
      additive: true,
    } as T;
  });

  assert.deepEqual(await client.get({ agentId: ' main ', includePlugins: true }), {
    agentId: 'main',
    profiles: [{ id: 'coding', label: 'Coding' }],
    groups: [{
      id: 'core',
      label: 'Core tools',
      source: 'core',
      tools: [{
        id: 'read',
        label: 'Read',
        description: 'Read a file',
        source: 'core',
        risk: 'low',
        tags: ['filesystem'],
        defaultProfiles: ['minimal', 'coding'],
      }],
    }, {
      id: 'plugin:voice',
      label: 'Voice',
      source: 'plugin',
      pluginId: 'voice-plugin',
      tools: [{
        id: 'speak',
        label: 'Speak',
        description: '',
        source: 'plugin',
        pluginId: 'voice-plugin',
        optional: true,
        defaultProfiles: [],
      }],
    }],
  });
  assert.deepEqual(calls, [{
    method: 'tools.catalog',
    params: { agentId: 'main', includePlugins: true },
  }]);
});

test('rejects malformed catalog fields without inventing defaults', () => {
  assert.deepEqual(parseOpenClawToolsCatalogResult({
    agentId: 'main',
    profiles: [],
    groups: [],
    futureField: true,
  }), { agentId: 'main', profiles: [], groups: [] });

  for (const value of [
    { agentId: '', profiles: [], groups: [] },
    { agentId: 'main', profiles: [{ id: 'unknown', label: 'x' }], groups: [] },
    { agentId: 'main', profiles: [], groups: [{ id: 'core', label: 'x', source: 'core', tools: [{ id: 'read', label: 'Read', description: '', source: 'core', defaultProfiles: ['unknown'] }] }] },
    { agentId: 'main', profiles: [], groups: [{ id: 'core', label: 'x', source: 'core', tools: [{ id: 'read', label: 'Read', description: '', source: 'core', defaultProfiles: [], optional: 'yes' }] }] },
    { agentId: 'main', profiles: [], groups: [{ id: 'core', label: 'x', source: 'core', tools: [{ id: 'read', label: 'Read', description: '', source: 'core', defaultProfiles: [], tags: [''] }] }] },
  ]) {
    assert.throws(() => parseOpenClawToolsCatalogResult(value), OpenClawToolsCatalogResponseError);
  }
});

test('validates optional request fields', async () => {
  const client = new OpenClawToolsCatalogClient(async <T>(): Promise<T> => ({
    agentId: 'main',
    profiles: [],
    groups: [],
  }) as T);
  await assert.rejects(client.get({ agentId: ' ' }));
  await assert.rejects(client.get({ includePlugins: 'yes' as unknown as boolean }));
});
