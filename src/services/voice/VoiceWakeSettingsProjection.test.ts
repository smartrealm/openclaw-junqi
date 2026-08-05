import assert from 'node:assert/strict';
import test from 'node:test';
import type { VoiceWakeGatewayEventListener } from '@/services/gateway/voiceWakeEventBridge';
import { subscribeVoiceWakeSettingsProjection } from './VoiceWakeSettingsProjection';

test('设置投影分别同步触发词和路由并隔离可变引用', () => {
  let listener: VoiceWakeGatewayEventListener = () => undefined;
  let triggers: readonly string[] = [];
  let routingTrigger = '';
  const unsubscribe = subscribeVoiceWakeSettingsProjection(
    (next) => {
      listener = next;
      return () => { listener = () => undefined; };
    },
    (next) => { triggers = next; },
    (next) => {
      routingTrigger = next.routes[0]?.trigger ?? '';
      if (next.routes[0]) next.routes[0].trigger = '本地修改';
    },
  );
  const config = {
    version: 1 as const,
    defaultTarget: { mode: 'current' as const },
    routes: [{ trigger: 'junqi', target: { agentId: 'main' } }],
    updatedAtMs: 100,
  };
  listener({ type: 'triggers', snapshot: { triggers: ['junqi'] } });
  listener({ type: 'routing', config });
  assert.deepEqual(triggers, ['junqi']);
  assert.equal(routingTrigger, 'junqi');
  assert.equal(config.routes[0]?.trigger, 'junqi');
  unsubscribe();
});
