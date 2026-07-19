import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelQrLoginSession, safeChannelQrDataUrl, type ChannelGatewayRpc } from './channelQrLogin';

function rpc(results: Array<unknown | Error>): ChannelGatewayRpc & { calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
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
    const session = new ChannelQrLoginSession(gateway, 'whatsapp', 'work');
    const phases: string[] = [];
    session.subscribe((state) => phases.push(state.phase));
    await session.start();
    assert.deepEqual(gateway.calls, [
      { method: 'web.login.start', params: { channel: 'whatsapp', accountId: 'work', force: false, timeoutMs: 30000 } },
      { method: 'web.login.wait', params: { channel: 'whatsapp', accountId: 'work', timeoutMs: 120000, currentQrDataUrl: 'data:image/png;base64,AAAA' } },
    ]);
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
    const session = new ChannelQrLoginSession(gateway, 'whatsapp');
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
    assert.equal(safeChannelQrDataUrl(`data:image/png;base64,${'A'.repeat(16_400)}`), null);
  });

  test('does not expose a raw Gateway error to the UI state', async () => {
    const session = new ChannelQrLoginSession(rpc([
      new Error('credential=should-not-reach-the-dialog'),
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().error, 'qr_request_failed');
    assert.equal(session.snapshot().message, '');
  });

  test('redacts credential-shaped Gateway status text', async () => {
    const session = new ChannelQrLoginSession(rpc([
      { connected: true, message: 'linked token=private-value' },
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().message, 'linked token=[REDACTED]');
  });

  test('rejects unsafe channel identifiers before making Gateway calls', () => {
    assert.throws(() => new ChannelQrLoginSession(rpc([]), '../whatsapp'), /invalid/);
  });

  test('reports expiration when wait returns no replacement QR', async () => {
    const session = new ChannelQrLoginSession(rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA' },
      { connected: false },
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().phase, 'expired');
  });
});
