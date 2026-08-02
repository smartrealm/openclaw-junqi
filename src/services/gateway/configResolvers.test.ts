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
    new FileReadResolver({
      detect: async () => ({
        token: 'docker-current',
        ws_url: 'ws://127.0.0.1:28789',
        runtime_mode: 'docker',
        config_path: '/state/docker/openclaw.json',
      }),
      resolveToken: async () => '',
    }),
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
  const resolver = new FileReadResolver({
    detect: async () => ({
      token: 'docker-token',
      ws_url: 'ws://127.0.0.1:18789',
      runtime_mode: 'docker',
      config_path: '/state/docker/openclaw.json',
      credential_scope: 'docker-state:verified-identity',
    }),
    resolveToken: async () => '',
  });
  assert.deepEqual(await resolver.resolve(), {
    token: 'docker-token',
    ws_url: 'ws://127.0.0.1:18789',
    credential_scope: 'docker-state:verified-identity',
  });
});

test('authoritative endpoint resolves a selected SecretRef through the official OpenClaw resolver', async () => {
  const calls: string[] = [];
  const resolver = new FileReadResolver({
    detect: async () => {
      calls.push('detect');
      return {
        token: null,
        ws_url: 'ws://127.0.0.1:18789',
        runtime_mode: 'native',
        config_path: '/state/native/openclaw.json',
      };
    },
    resolveToken: async () => {
      calls.push('resolveToken');
      return 'resolved-secret-token';
    },
  });
  assert.deepEqual(await resolver.resolve(), {
    token: 'resolved-secret-token',
    ws_url: 'ws://127.0.0.1:18789',
    credential_scope: 'native:/state/native/openclaw.json',
  });
  assert.deepEqual(calls, ['detect', 'resolveToken']);
});

test('SecretRef resolution failure never falls through to a stale runtime endpoint', async () => {
  const chain = new ConfigResolverChain([
    new FileReadResolver({
      detect: async () => {
        return {
          token: null,
          ws_url: 'ws://127.0.0.1:28789',
          runtime_mode: 'docker',
          config_path: '/state/docker/openclaw.json',
        };
      },
      resolveToken: async () => { throw new Error('official SecretRef resolution failed'); },
    }),
    new CachedTokenResolver(() => ({ token: 'stale-native-token', ws_url: 'ws://127.0.0.1:18789' })),
  ]);

  assert.deepEqual(await chain.resolve(), {
    token: '',
    ws_url: 'ws://127.0.0.1:28789',
    credential_scope: 'docker:/state/docker/openclaw.json',
  });
});
