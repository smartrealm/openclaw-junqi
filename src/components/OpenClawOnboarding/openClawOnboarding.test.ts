import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasMainAgent,
  hasMainAgentConversation,
  hasOpenClawConversation,
  isOpenClawOnboardingComplete,
} from './onboardingState';
import { hasConfiguredChannel, inspectOpenClawStartupRuntime } from './runtimeState';

test('OpenClaw onboarding needs a real first conversation, not a created session', () => {
  assert.equal(hasOpenClawConversation(undefined), false);
  assert.equal(hasOpenClawConversation({ key: 'agent:main:main', totalTokens: 0 }), false);
  assert.equal(hasOpenClawConversation({ key: 'agent:main:main', totalTokens: 1 }), true);
  assert.equal(hasOpenClawConversation({ key: 'agent:main:main', lastMessage: { content: 'hello' } }), true);
  assert.equal(hasOpenClawConversation({ key: 'agent:main:main', lastMessage: { content: '  ' } }), false);
});

test('OpenClaw onboarding completes only after the usable core path is ready', () => {
  assert.equal(isOpenClawOnboardingComplete({ gatewayReady: true, providerReady: true, mainAgentReady: false, conversationReady: false, channelReady: false }), false);
  assert.equal(isOpenClawOnboardingComplete({ gatewayReady: true, providerReady: true, mainAgentReady: false, conversationReady: true, channelReady: false }), false);
  assert.equal(isOpenClawOnboardingComplete({ gatewayReady: true, providerReady: true, mainAgentReady: true, conversationReady: true, channelReady: false }), true);
});

test('main-agent readiness and conversation evidence use OpenClaw identities', () => {
  assert.equal(hasMainAgent([{ id: 'researcher' }]), false);
  assert.equal(hasMainAgent([{ id: 'main' }]), true);
  assert.equal(hasMainAgentConversation([
    { key: 'agent:main:webchat', lastMessage: 'hello' },
  ]), true);
  assert.equal(hasMainAgentConversation([
    { key: 'agent:main:cron:nightly', totalTokens: 20 },
    { key: 'agent:main:subagent:worker', lastMessage: 'done' },
  ]), false);
  assert.equal(hasMainAgentConversation([
    { key: 'agent:other:main', lastMessage: 'hello' },
  ]), false);
});

test('configured channel projection ignores a merely enabled account', () => {
  assert.equal(hasConfiguredChannel({ configuredChannels: ['telegram'] }), true);
  assert.equal(hasConfiguredChannel({ channelAccounts: { feishu: [{ accountId: 'default', configured: true }] } }), true);
  assert.equal(hasConfiguredChannel({ channelAccounts: { weixin: [{ accountId: 'default', linked: true }] } }), true);
  assert.equal(hasConfiguredChannel({ channelAccounts: { slack: [{ accountId: 'default', enabled: true }] } }), false);
  assert.equal(hasConfiguredChannel(null), false);
});

test('runtime inspection isolates provider and channel failures and uses the channel adapter fallback', async () => {
  const calls: string[] = [];
  const runtime = await inspectOpenClawStartupRuntime({
    call: async (method) => {
      calls.push(method);
      if (method === 'models.list') return { models: [{ provider: 'openai', id: 'gpt-5.5' }] };
      throw new Error('Gateway method unavailable');
    },
    readChannelStatus: async () => ({ configuredChannels: ['feishu'] }),
  });
  assert.deepEqual(runtime, { provider: 'ready', channel: 'ready' });
  assert.deepEqual(calls.sort(), ['channels.status', 'models.list']);

  const unavailable = await inspectOpenClawStartupRuntime({
    call: async () => { throw new Error('offline'); },
    readChannelStatus: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(unavailable, { provider: 'unavailable', channel: 'unavailable' });
});
