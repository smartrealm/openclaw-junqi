import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CachedTokenResolver,
  ConfigResolverChain,
  EventPayloadResolver,
  FileReadResolver,
} from './configResolvers';

test('selected OpenClaw config outranks stale event and volatile credentials', async () => {
  const chain = new ConfigResolverChain([
    new FileReadResolver(async () => ({
      token: 'docker-current',
      ws_url: 'ws://127.0.0.1:28789',
      runtime_mode: 'docker',
      config_path: '/state/docker/openclaw.json',
    })),
    new EventPayloadResolver(() => ({
      token: 'event-old',
      ws_url: 'ws://127.0.0.1:18789',
    })),
    new CachedTokenResolver(() => ({
      token: 'native-old',
      ws_url: 'ws://127.0.0.1:18789',
    })),
  ]);

  assert.deepEqual(await chain.resolve(), {
    token: 'docker-current',
    ws_url: 'ws://127.0.0.1:28789',
    credential_scope: 'docker:/state/docker/openclaw.json',
  });
});

test('backend credential scope remains authoritative when runtimes share one endpoint', async () => {
  const resolver = new FileReadResolver(async () => ({
    token: 'docker-token',
    ws_url: 'ws://127.0.0.1:18789',
    runtime_mode: 'docker',
    config_path: '/state/docker/openclaw.json',
    credential_scope: 'docker-state:verified-identity',
  }));
  assert.deepEqual(await resolver.resolve(), {
    token: 'docker-token',
    ws_url: 'ws://127.0.0.1:18789',
    credential_scope: 'docker-state:verified-identity',
  });
});

test('authoritative endpoint resolves a selected SecretRef through the official OpenClaw resolver', async () => {
  const calls: string[] = [];
  const resolver = new FileReadResolver(async (command) => {
    calls.push(command);
    if (command === 'detect_gateway_config') {
      return {
        token: null,
        ws_url: 'ws://127.0.0.1:18789',
        runtime_mode: 'native',
        config_path: '/state/native/openclaw.json',
      };
    }
    if (command === 'get_gateway_token') return 'resolved-secret-token';
    throw new Error(`unexpected ${command}`);
  });
  assert.deepEqual(await resolver.resolve(), {
    token: 'resolved-secret-token',
    ws_url: 'ws://127.0.0.1:18789',
    credential_scope: 'native:/state/native/openclaw.json',
  });
  assert.deepEqual(calls, ['detect_gateway_config', 'get_gateway_token']);
});

test('SecretRef resolution failure never falls through to a stale runtime endpoint', async () => {
  const chain = new ConfigResolverChain([
    new FileReadResolver(async (command) => {
      if (command === 'detect_gateway_config') {
        return {
          token: null,
          ws_url: 'ws://127.0.0.1:28789',
          runtime_mode: 'docker',
          config_path: '/state/docker/openclaw.json',
        };
      }
      throw new Error('official SecretRef resolution failed');
    }),
    new CachedTokenResolver(() => ({ token: 'stale-native-token', ws_url: 'ws://127.0.0.1:18789' })),
  ]);

  assert.deepEqual(await chain.resolve(), {
    token: '',
    ws_url: 'ws://127.0.0.1:28789',
    credential_scope: 'docker:/state/docker/openclaw.json',
  });
});
