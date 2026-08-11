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
  test('从二维码准备进入官方等待并以官方成功回调收敛', async () => {
    const gateway = rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: true, message: 'linked' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'whatsapp', 'work');
    const phases: string[] = [];
    session.subscribe((state) => phases.push(state.phase));
    await session.start();
    assert.deepEqual(gateway.calls[0], {
      method: 'web.login.start',
      params: { accountId: 'work', force: false, timeoutMs: 30000 },
    });
    assert.equal(gateway.calls[1]?.method, 'web.login.wait');
    assert.equal(gateway.calls[1]?.params.accountId, 'work');
    assert.equal(gateway.calls[1]?.params.currentQrDataUrl, 'data:image/png;base64,AAAA');
    assert.ok(Number(gateway.calls[1]?.params.timeoutMs) > 0);
    assert.ok(Number(gateway.calls[1]?.params.timeoutMs) <= 120000);
    assert.deepEqual(phases, ['idle', 'preparing', 'waiting', 'connected']);
    assert.equal(session.snapshot().message, 'linked');
  });

  test('开始请求直接返回 connected 时不再增加第二套状态门禁', async () => {
    const gateway = rpc([{ connected: true, message: 'linked' }]);
    const session = new ChannelQrLoginSession(gateway, 'qqbot', 'work');
    await session.start();
    assert.equal(session.snapshot().phase, 'connected');
    assert.deepEqual(gateway.calls.map((call) => call.method), ['web.login.start']);
  });

  test('二维码轮换后使用新二维码继续当前有界等待', async () => {
    const gateway = rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: false, message: 'refreshed', qrDataUrl: 'data:image/png;base64,BBBB' },
      { connected: true, message: 'linked' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'whatsapp');
    await session.start();
    assert.equal(gateway.calls.length, 3);
    assert.equal(gateway.calls[2]?.params.currentQrDataUrl, 'data:image/png;base64,BBBB');
    assert.equal(session.snapshot().phase, 'connected');
  });

  test('官方等待返回未连接且没有新二维码时停止自动请求并保留二维码', async () => {
    const gateway = rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: false, message: 'still waiting' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'whatsapp');
    await session.start();
    assert.equal(gateway.calls.length, 2);
    assert.deepEqual(session.snapshot(), {
      phase: 'pending',
      qrDataUrl: 'data:image/png;base64,AAAA',
      message: 'still waiting',
      error: '',
    });
  });

  test('继续等待只调用 wait 并沿用当前二维码', async () => {
    const gateway = rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: false, message: 'still waiting' },
      { connected: true, message: 'linked' },
    ]);
    const session = new ChannelQrLoginSession(gateway, 'whatsapp', 'work');
    await session.start();
    await session.continueWaiting();
    assert.deepEqual(gateway.calls.map((call) => call.method), [
      'web.login.start',
      'web.login.wait',
      'web.login.wait',
    ]);
    assert.equal(gateway.calls[2]?.params.currentQrDataUrl, 'data:image/png;base64,AAAA');
    assert.equal(session.snapshot().phase, 'connected');
  });

  test('取消后丢弃旧等待请求返回的成功结果', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelQrLoginGateway = {
      async start() {
        return { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' };
      },
      async wait() {
        return new Promise((resolve) => { resolveWait = resolve; });
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'whatsapp');
    const pending = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    resolveWait?.({ connected: true, message: 'linked' });
    await pending;
    assert.equal(session.snapshot().phase, 'cancelled');
  });

  test('拒绝远程地址、非 PNG 和超长二维码', () => {
    assert.equal(safeChannelQrDataUrl('https://example.com/qr.png'), null);
    assert.equal(safeChannelQrDataUrl('data:image/svg+xml;base64,AAAA'), null);
    assert.equal(safeChannelQrDataUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(safeChannelQrDataUrl(`data:image/png;base64,${'A'.repeat(16_400)}`), null);
  });

  test('关闭对话框只停止本地投影，不调用不存在的取消 RPC', async () => {
    let resolveWait: ((value: unknown) => void) | undefined;
    const gateway: ChannelQrLoginGateway & { calls: string[] } = {
      calls: [],
      async start() {
        this.calls.push('web.login.start');
        return { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' };
      },
      async wait() {
        this.calls.push('web.login.wait');
        return new Promise((resolve) => { resolveWait = resolve; });
      },
    };
    const session = new ChannelQrLoginSession(gateway, 'qqbot', 'primary');
    const pending = session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    session.cancel();
    resolveWait?.({ connected: true, message: 'linked' });
    await pending;
    assert.deepEqual(gateway.calls, ['web.login.start', 'web.login.wait']);
  });

  test('不向界面暴露原始 Gateway 错误', async () => {
    const session = new ChannelQrLoginSession(rpc([
      new Error('credential=should-not-reach-the-dialog'),
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().error, 'qr_start_failed');
    assert.equal(session.snapshot().message, '');
  });

  test('脱敏插件返回的凭据形状文本', async () => {
    const session = new ChannelQrLoginSession(rpc([
      { connected: true, message: 'linked token=private-value' },
    ]), 'whatsapp');
    await session.start();
    assert.equal(session.snapshot().message, 'linked token=[REDACTED]');
  });

  test('错误结果形状不会被静默解释成等待', async () => {
    const invalidStart = new ChannelQrLoginSession(rpc([{ connected: false }]), 'whatsapp');
    await invalidStart.start();
    assert.equal(invalidStart.snapshot().error, 'qr_invalid_response');

    const invalidWait = new ChannelQrLoginSession(rpc([
      { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' },
      { connected: 'yes', message: 'linked' },
    ]), 'whatsapp');
    await invalidWait.start();
    assert.equal(invalidWait.snapshot().error, 'qr_invalid_response');
    assert.equal(invalidWait.snapshot().qrDataUrl, 'data:image/png;base64,AAAA');
  });

  test('拒绝不安全的渠道标识且不发起 Gateway 请求', () => {
    assert.throws(() => new ChannelQrLoginSession(rpc([]), '../whatsapp'), /invalid/);
  });

  test('官方等待进行时不并发发起新的开始请求', async () => {
    let resolveFirstWait: ((value: unknown) => void) | undefined;
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const gateway: ChannelQrLoginGateway = {
      async start(params) {
        calls.push({ method: 'web.login.start', params });
        return { qrDataUrl: 'data:image/png;base64,AAAA', message: 'scan' };
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
    assert.deepEqual(calls.map((call) => call.method), ['web.login.start', 'web.login.wait']);
    resolveFirstWait?.({ connected: true, message: 'linked' });
    await first;
    assert.equal(calls.some((call) => call.method === 'web.login.cancel'), false);
    assert.equal(session.snapshot().phase, 'connected');
    assert.equal(session.snapshot().message, 'linked');
  });
});
