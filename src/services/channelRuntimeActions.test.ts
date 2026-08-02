import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { channelRuntimeActionParams, runChannelRuntimeAction } from './channelRuntimeActions';

describe('channelRuntimeActions', () => {
  test('uses the privileged Gateway lane for channel lifecycle controls', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const request = async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      return { ok: true };
    };

    await runChannelRuntimeAction(request, 'channels.start', { channelId: 'telegram', accountId: 'work' });

    assert.deepEqual(calls, [{
      method: 'channels.start',
      params: { channel: 'telegram', accountId: 'work' },
    }]);
  });

  test('omits OpenClaw default account IDs and rejects an empty channel ID', () => {
    assert.deepEqual(channelRuntimeActionParams({ channelId: ' slack ', accountId: 'default' }), { channel: 'slack' });
    assert.throws(() => channelRuntimeActionParams({ channelId: '   ' }), /Channel ID is required/);
  });
});
