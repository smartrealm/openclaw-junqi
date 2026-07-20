import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelQrLoginSession,
  safeChannelQrContent,
  safeChannelQrDataUrl,
  type ChannelGatewayRpc,
} from './channelQrLogin';

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

  test('publishes connected only after the official channel status is verified', async () => {
    const verified = new ChannelQrLoginSession(
      rpc([{ connected: true, message: 'linked' }]),
      'qqbot',
      'work',
      async () => true,
    );
    const phases: string[] = [];
    verified.subscribe((state) => phases.push(state.phase));
    await verified.start();
    assert.deepEqual(phases, ['idle', 'preparing', 'verifying', 'connected']);

    const notReady = new ChannelQrLoginSession(
      rpc([{ connected: true }]),
      'qqbot',
      'work',
      async () => false,
    );
    await notReady.start();
    assert.equal(notReady.snapshot().phase, 'error');
    assert.equal(notReady.snapshot().error, 'qr_not_ready');
  });

  test('cancel prevents an old wait request from publishing stale success', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelGatewayRpc = {
      async call(method) {
        if (method === 'web.login.start') return { qrDataUrl: 'data:image/png;base64,AAAA' };
        if (method === 'web.login.wait') return new Promise((resolve) => { resolveWait = resolve; });
        return { cancelled: true };
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

  test('accepts bounded opaque QR payloads from the selected local provider', () => {
    assert.equal(safeChannelQrContent('https://ilinkai.weixin.qq.com/login?id=one'), 'https://ilinkai.weixin.qq.com/login?id=one');
    assert.equal(safeChannelQrContent('dingtalk://dingtalkclient/action/openapp?corpId=one'), 'dingtalk://dingtalkclient/action/openapp?corpId=one');
    assert.equal(safeChannelQrContent('sgnl://linkdevice?uuid=one'), 'sgnl://linkdevice?uuid=one');
    assert.equal(safeChannelQrContent(`https://example.com/${'x'.repeat(4_100)}`), null);
    assert.equal(safeChannelQrContent('opaque\nprovider-payload'), null);
  });

  test('preserves an opaque provider session across QR waits', async () => {
    const gateway = rpc([
      { qrContent: 'https://ilinkai.weixin.qq.com/login?id=one', sessionId: 'provider-session', message: 'scan' },
      { connected: true, message: 'linked' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'openclaw-weixin');
    await session.start();
    assert.deepEqual(gateway.calls, [
      { method: 'web.login.start', params: { channel: 'openclaw-weixin', force: false, timeoutMs: 30000 } },
      { method: 'web.login.wait', params: { channel: 'openclaw-weixin', sessionId: 'provider-session', timeoutMs: 120000, currentQrDataUrl: null } },
    ]);
  });

  test('cancels the provider session when the dialog closes', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelGatewayRpc & { calls: Array<{ method: string; params: Record<string, unknown> }> } = {
      calls: [],
      async call(method, params) {
        this.calls.push({ method, params });
        if (method === 'web.login.start') return { qrContent: 'https://example.com/qr', sessionId: 'session-1' };
        if (method === 'web.login.wait') return new Promise((resolve) => { resolveWait = resolve; });
        return { cancelled: true };
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'qqbot', 'primary');
    const pending = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    resolveWait?.({ connected: true });
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(gateway.calls.at(-1), {
      method: 'web.login.cancel',
      params: { channel: 'qqbot', accountId: 'primary', sessionId: 'session-1' },
    });
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

  test('keeps the active QR visible while the provider remains pending without a replacement code', async () => {
    const session = new ChannelQrLoginSession(rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA' },
      { connected: false, message: 'still waiting', pollAfterMs: 1 },
      { connected: true },
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().phase, 'connected');
  });

  test('releases an earlier provider session before refreshing the QR code', async () => {
    let resolveFirstWait: ((value: unknown) => void) | undefined;
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const gateway: ChannelGatewayRpc = {
      async call(method, params) {
        calls.push({ method, params });
        if (method === 'web.login.start' && calls.filter((call) => call.method === method).length === 1) {
          return { qrContent: 'https://example.com/first', sessionId: 'first-session' };
        }
        if (method === 'web.login.start') return { connected: true };
        if (method === 'web.login.wait') return new Promise((resolve) => { resolveFirstWait = resolve; });
        return { cancelled: true };
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'qqbot');
    const first = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.start(true);
    resolveFirstWait?.({ connected: true });
    await first;
    assert.ok(calls.some((call) => call.method === 'web.login.cancel' && call.params.sessionId === 'first-session'));
    assert.equal(session.snapshot().phase, 'connected');
  });

  test('maps explicit provider terminal states without waiting for the local deadline', async () => {
    const denied = new ChannelQrLoginSession(rpc([{ status: 'denied', message: 'declined' }]), 'whatsapp');
    await denied.start();
    assert.equal(denied.snapshot().phase, 'denied');

    const expired = new ChannelQrLoginSession(rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA' },
      { status: 'expired' },
    ]), 'whatsapp');
    await expired.start();
    assert.equal(expired.snapshot().phase, 'expired');

    const failed = new ChannelQrLoginSession(rpc([
      { status: 'error', message: 'provider ended login' },
    ]), 'qqbot');
    await failed.start();
    assert.equal(failed.snapshot().phase, 'error');
    assert.equal(failed.snapshot().error, 'qr_login_failed');
  });
});
