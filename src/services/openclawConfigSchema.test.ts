import test from 'node:test';
import assert from 'node:assert/strict';
import { configFieldSchema, providerFieldSchemas, providerModelFieldSchemas, schemaStringOptions, schemaValueKind } from './openclawConfigSchema';

test('BUG-MP-06 extracts provider fields from the official config schema path', () => {
  const fields = providerFieldSchemas({
    properties: {
      models: {
        properties: {
          providers: {
            additionalProperties: {
              properties: { timeoutSeconds: { type: 'integer' } },
            },
          },
        },
      },
    },
  });
  assert.equal(schemaValueKind(fields.timeoutSeconds), 'integer');
});

test('BUG-MP-06 derives enum-like const unions used by official schema', () => {
  const schema = { anyOf: [{ type: 'string', const: 'api-key' }, { type: 'string', const: 'oauth' }] };
  assert.deepEqual(schemaStringOptions(schema), ['api-key', 'oauth']);
  assert.equal(schemaValueKind(schema), 'string');
});

test('BUG-OCA-01 resolves arbitrary config paths and local JSON schema references', () => {
  const schema = {
    properties: {
      agents: { $ref: '#/$defs/agents' },
    },
    $defs: {
      agents: {
        properties: {
          defaults: {
            properties: {
              compaction: {
                properties: {
                  mode: { anyOf: [{ const: 'default' }, { const: 'safeguard' }] },
                },
              },
            },
          },
        },
      },
    },
  };
  assert.deepEqual(
    schemaStringOptions(configFieldSchema(schema, 'agents.defaults.compaction.mode') ?? {}),
    ['default', 'safeguard'],
  );
  assert.equal(configFieldSchema(schema, 'agents.defaults.missing'), undefined);
});

test('BUG-OCA-04 fails closed for cyclic or external schema references', () => {
  const cyclic = { properties: { value: { $ref: '#/properties/value' } } };
  assert.equal(configFieldSchema(cyclic, 'value'), undefined);
  assert.equal(configFieldSchema({ properties: { value: { $ref: 'remote.json#/value' } } }, 'value'), undefined);
});

test('BUG-MP-06 extracts model fields from the official nested model schema', () => {
  const fields = providerModelFieldSchemas({
    properties: {
      models: {
        properties: {
          providers: {
            additionalProperties: {
              properties: {
                models: { items: { properties: { reasoning: { type: 'boolean' } } } },
              },
            },
          },
        },
      },
    },
  });
  assert.equal(schemaValueKind(fields.reasoning), 'boolean');
});
