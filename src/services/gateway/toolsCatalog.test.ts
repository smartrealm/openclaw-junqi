import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildToolsCatalogParams,
  parseToolsCatalogResult,
} from './toolsCatalog';

test('tools.catalog request keeps the official optional envelope', () => {
  assert.deepEqual(buildToolsCatalogParams(' main ', true), { agentId: 'main', includePlugins: true });
  assert.deepEqual(buildToolsCatalogParams(), {});
  assert.deepEqual(buildToolsCatalogParams('  ', false), { includePlugins: false });
});

test('tools.catalog response preserves profiles, groups and plugin provenance', () => {
  assert.deepEqual(parseToolsCatalogResult({
    agentId: 'main',
    profiles: [{ id: 'coding', label: 'Coding' }],
    groups: [{
      id: 'plugin:browser',
      label: 'Browser',
      source: 'plugin',
      pluginId: 'browser',
      tools: [{
        id: 'browser.open',
        label: 'Open page',
        description: 'Open a page',
        source: 'plugin',
        pluginId: 'browser',
        optional: true,
        risk: 'medium',
        tags: ['browser'],
        defaultProfiles: [],
      }],
    }],
  }), {
    agentId: 'main',
    profiles: [{ id: 'coding', label: 'Coding' }],
    groups: [{
      id: 'plugin:browser',
      label: 'Browser',
      source: 'plugin',
      pluginId: 'browser',
      tools: [{
        id: 'browser.open',
        label: 'Open page',
        description: 'Open a page',
        source: 'plugin',
        pluginId: 'browser',
        optional: true,
        risk: 'medium',
        tags: ['browser'],
        defaultProfiles: [],
      }],
    }],
  });
});

test('tools.catalog rejects missing strict catalog fields', () => {
  assert.throws(() => parseToolsCatalogResult({
    agentId: 'main',
    profiles: [{ id: 'coding', label: 'Coding' }],
    groups: [{ id: 'core', label: 'Core', source: 'core', tools: [{ id: 'x' }] }],
  }), /label/);
  assert.throws(() => parseToolsCatalogResult({
    agentId: 'main',
    profiles: [{ id: 'unknown', label: 'Unknown' }],
    groups: [],
  }), /profiles\[0\]\.id/);
});
