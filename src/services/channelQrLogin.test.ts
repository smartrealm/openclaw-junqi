import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelQrLoginSession, safeChannelQrDataUrl, type ChannelGatewayRpc } from './channelQrLogin';

function rpc(results: Array<unknown | Error>): ChannelGatewayRpc & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async call(method) {
      calls.push(method);
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

describe('ChannelQrLoginSession', () => {
  test('moves from QR preparation through wait to connected', async () => {
    const gateway = rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: true, message: 'linked' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'work');
    const phases: string[] = [];
    session.subscribe((state) => phases.push(state.phase));
    await session.start();
    assert.deepEqual(gateway.calls, ['web.login.start', 'web.login.wait']);
    assert.deepEqual(phases, ['idle', 'preparing', 'waiting', 'connected']);
    assert.equal(session.snapshot().message, 'linked');
  });

  test('cancel prevents an old wait request from publishing stale success', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelGatewayRpc = {
      async call(method) {
        if (method === 'web.login.start') return { qrDataUrl: 'data:image/png;base64,AAAA' };
        return new Promise((resolve) => { resolveWait = resolve; });
      },
    };
    const session = new ChannelQrLoginSession(gateway);
    const pending = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    resolveWait?.({ connected: true });
    await pending;
    assert.equal(session.snapshot().phase, 'cancelled');
  });

  test('rejects remote and non-PNG QR sources', () => {
    assert.equal(safeChannelQrDataUrl('https://example.com/qr.png'), null);
    assert.equal(safeChannelQrDataUrl('data:image/svg+xml;base64,AAAA'), null);
    assert.equal(safeChannelQrDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
  });

  test('reports expiration when wait returns no replacement QR', async () => {
    const session = new ChannelQrLoginSession(rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA' },
      { connected: false },
    ]));
    await session.start();
    assert.equal(session.snapshot().phase, 'expired');
  });
});
