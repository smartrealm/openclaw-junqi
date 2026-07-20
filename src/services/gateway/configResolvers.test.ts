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

test('authoritative endpoint remains usable when its token is SecretRef-managed', async () => {
  const resolver = new FileReadResolver(async () => ({
    token: null,
    ws_url: 'ws://127.0.0.1:18789',
  }));
  assert.deepEqual(await resolver.resolve(), {
    token: '',
    ws_url: 'ws://127.0.0.1:18789',
    credential_scope: 'unknown:',
  });
});
