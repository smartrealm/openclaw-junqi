import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelQrLoginSession,
  safeChannelQrDataUrl,
  type ChannelQrLoginGateway,
} from './channelQrLogin';

function rpc(results: Array<unknown | Error>): ChannelQrLoginGateway & { calls: Array<{ method: string; params: Record<string, unknown> }> } {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const next = () => {
    const result = results.shift();
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    calls,
    async start(params) {
      calls.push({ method: 'web.login.start', params });
      return next();
    },
    async wait(params) {
      calls.push({ method: 'web.login.wait', params });
      return next();
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
      { method: 'web.login.start', params: { accountId: 'work', force: false, timeoutMs: 30000 } },
      { method: 'web.login.wait', params: { accountId: 'work', timeoutMs: 120000, currentQrDataUrl: 'data:image/png;base64,AAAA' } },
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
    const gateway: ChannelQrLoginGateway = {
      async start() {
        return { qrDataUrl: 'data:image/png;base64,AAAA' };
      },
      async wait() {
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

  test('关闭对话框只停止本地投影，不调用不存在的取消 RPC', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelQrLoginGateway & { calls: Array<{ method: string; params: Record<string, unknown> }> } = {
      calls: [],
      async start(params) {
        this.calls.push({ method: 'web.login.start', params });
        return { qrDataUrl: 'data:image/png;base64,AAAA' };
      },
      async wait(params) {
        this.calls.push({ method: 'web.login.wait', params });
        return new Promise((resolve) => { resolveWait = resolve; });
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'qqbot', 'primary');
    const pending = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    resolveWait?.({ connected: true });
    await pending;
    assert.deepEqual(gateway.calls.map((call) => call.method), ['web.login.start', 'web.login.wait']);
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

  test('刷新二维码时以本地代际围栏丢弃先前等待结果', async () => {
    let resolveFirstWait: ((value: unknown) => void) | undefined;
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const gateway: ChannelQrLoginGateway = {
      async start(params) {
        calls.push({ method: 'web.login.start', params });
        if (calls.filter((call) => call.method === 'web.login.start').length === 1) {
          return { qrDataUrl: 'data:image/png;base64,AAAA' };
        }
        return { connected: true };
      },
      async wait(params) {
        calls.push({ method: 'web.login.wait', params });
        return new Promise((resolve) => { resolveFirstWait = resolve; });
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'qqbot');
    const first = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await session.start(true);
    resolveFirstWait?.({ connected: true });
    await first;
    assert.equal(calls.some((call) => call.method === 'web.login.cancel'), false);
    assert.equal(session.snapshot().phase, 'connected');
  });

});
