import assert from 'node:assert/strict';
import test from 'node:test';
import { hasReadyChannelAccount } from './channelReadiness';

test('channel guide fact requires a reachable runtime and ready account', () => {
  const config = { channels: { telegram: { enabled: true, accounts: { work: { enabled: true } } } } };
  assert.equal(hasReadyChannelAccount(config, { gatewayReachable: false, channelAccounts: { telegram: [{ accountId: 'work', configured: true, enabled: true }] } }), false);
  assert.equal(hasReadyChannelAccount(config, { gatewayReachable: true, channelAccounts: { telegram: [{ accountId: 'work', configured: true, enabled: true }] } }), true);
});
