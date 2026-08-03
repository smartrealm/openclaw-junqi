import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildToolsEffectiveParams,
  parseToolsEffectiveResult,
} from './toolsEffective';

test('tools.effective request keeps the official session-scoped envelope', () => {
  assert.deepEqual(buildToolsEffectiveParams(' agent:main:main ', ' main '), {
    sessionKey: 'agent:main:main',
    agentId: 'main',
  });
  assert.deepEqual(buildToolsEffectiveParams('agent:main:main'), {
    sessionKey: 'agent:main:main',
  });
  assert.throws(() => buildToolsEffectiveParams('   '), /sessionKey/);
});

test('tools.effective response preserves groups, provenance and runtime notices', () => {
  assert.deepEqual(parseToolsEffectiveResult({
    agentId: 'main',
    profile: 'coding',
    groups: [{
      id: 'mcp',
      label: 'MCP',
      source: 'mcp',
      tools: [{
        id: 'browser.open',
        label: 'Open page',
        description: 'Open a page',
        rawDescription: 'Open a page in the configured browser',
        source: 'mcp',
        pluginId: 'bundle-mcp',
        risk: 'medium',
        tags: ['browser'],
      }],
    }],
    notices: [{ id: 'mcp-not-yet-listed', severity: 'info', message: 'Waiting for discovery' }],
  }), {
    agentId: 'main',
    profile: 'coding',
    groups: [{
      id: 'mcp',
      label: 'MCP',
      source: 'mcp',
      tools: [{
        id: 'browser.open',
        label: 'Open page',
        description: 'Open a page',
        rawDescription: 'Open a page in the configured browser',
        source: 'mcp',
        pluginId: 'bundle-mcp',
        risk: 'medium',
        tags: ['browser'],
      }],
    }],
    notices: [{ id: 'mcp-not-yet-listed', severity: 'info', message: 'Waiting for discovery' }],
  });
});

test('tools.effective rejects missing strict fields instead of inventing a fallback', () => {
  assert.throws(() => parseToolsEffectiveResult({
    agentId: 'main',
    profile: 'coding',
    groups: [{ id: 'core', label: 'Core', source: 'core', tools: [{ id: 'x', label: 'X', description: 'x' }] }],
  }), /rawDescription/);
  assert.throws(() => parseToolsEffectiveResult({ agentId: 'main', profile: 'coding', groups: [] , notices: [{ id: 'x', severity: 'error', message: '' }] }), /severity/);
});
