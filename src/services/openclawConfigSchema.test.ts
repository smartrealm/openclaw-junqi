import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configFieldSchema,
  configObjectFieldSchemas,
  OpenClawConfigSchemaClient,
  OpenClawConfigSchemaResponseError,
  OpenClawConfigSchemaUnavailableError,
  parseOpenClawConfigSchemaResponse,
  providerFieldSchemas,
  providerModelFieldSchemas,
  schemaStringOptions,
  schemaValueKind,
} from './openclawConfigSchema';

function configSchemaResponse(marker = 'default') {
  return {
    schema: { properties: { tools: { properties: { [marker]: { type: 'boolean' } } } } },
    uiHints: {},
    version: '2026.8',
    generatedAt: '2026-08-09T06:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

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

test('BUG-RCS-01 extracts the JSON schema from the official config.schema response envelope', () => {
  const response = parseOpenClawConfigSchemaResponse(configSchemaResponse('sandbox'));
  assert.deepEqual(Object.keys(configObjectFieldSchemas(response.schema, 'tools')), ['sandbox']);
  assert.equal(response.version, '2026.8');
});

test('BUG-RCS-01 rejects bare schemas and incomplete config.schema envelopes', () => {
  assert.throws(
    () => parseOpenClawConfigSchemaResponse({ properties: {} }),
    OpenClawConfigSchemaResponseError,
  );
  assert.throws(
    () => parseOpenClawConfigSchemaResponse({ schema: {}, uiHints: {}, version: '2026.8' }),
    OpenClawConfigSchemaResponseError,
  );
});

test('BUG-RCS-02 reuses schema only within the same attested Gateway connection', async () => {
  let connectionId = 'gateway-a';
  let calls = 0;
  const client = new OpenClawConfigSchemaClient({
    captureConnectionId: () => connectionId,
    isConnectionCurrent: (candidate) => candidate === connectionId,
    callPrivileged: async () => {
      calls += 1;
      return configSchemaResponse(`request-${calls}`);
    },
  });

  const first = await client.load();
  const cached = await client.load();
  assert.equal(calls, 1);
  assert.deepEqual(cached, first);

  connectionId = 'gateway-b';
  const switched = await client.load();
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(configObjectFieldSchemas(switched, 'tools')), ['request-2']);
});

test('BUG-RCS-02 rejects a schema response when the Gateway connection changes in flight', async () => {
  let connectionId = 'gateway-a';
  const response = deferred<unknown>();
  const client = new OpenClawConfigSchemaClient({
    captureConnectionId: () => connectionId,
    isConnectionCurrent: (candidate) => candidate === connectionId,
    callPrivileged: () => response.promise,
  });

  const pending = client.load();
  connectionId = 'gateway-b';
  response.resolve(configSchemaResponse());
  await assert.rejects(pending, OpenClawConfigSchemaUnavailableError);
});

test('BUG-RCS-03 force reload bypasses the current connection cache', async () => {
  let calls = 0;
  const client = new OpenClawConfigSchemaClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    callPrivileged: async () => {
      calls += 1;
      return configSchemaResponse(`request-${calls}`);
    },
  });

  await client.load();
  const refreshed = await client.load({ force: true });
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(configObjectFieldSchemas(refreshed, 'tools')), ['request-2']);
});

test('BUG-RCS-03 failed schema requests are not retained in the connection cache', async () => {
  let calls = 0;
  const client = new OpenClawConfigSchemaClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    callPrivileged: async () => {
      calls += 1;
      if (calls === 1) throw new Error('temporary failure');
      return configSchemaResponse('recovered');
    },
  });

  await assert.rejects(client.load(), /temporary failure/);
  const recovered = await client.load();
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys(configObjectFieldSchemas(recovered, 'tools')), ['recovered']);
});
