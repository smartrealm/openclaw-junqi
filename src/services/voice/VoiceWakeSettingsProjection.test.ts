import assert from 'node:assert/strict';
import test from 'node:test';
import {
  subscribeVoiceWakeSettingsTriggerProjection,
  type VoiceWakeGatewayEventSubscriber,
} from './VoiceWakeSettingsProjection';
import type { VoiceWakeGatewayEvent, VoiceWakeGatewayEventListener } from '@/services/gateway/voiceWakeEventBridge';

test('projects only Gateway trigger broadcasts and releases the event listener', () => {
  const listeners = new Set<VoiceWakeGatewayEventListener>();
  let unsubscribed = 0;
  const updates: string[][] = [];
  const subscribe: VoiceWakeGatewayEventSubscriber = (nextListener) => {
    listeners.add(nextListener);
    return () => {
      listeners.delete(nextListener);
      unsubscribed += 1;
    };
  };
  const emit = (event: VoiceWakeGatewayEvent) => {
    for (const listener of listeners) listener(event);
  };

  const release = subscribeVoiceWakeSettingsTriggerProjection(subscribe, (triggers) => {
    updates.push([...triggers]);
  });

  emit({
    type: 'routing',
    config: { version: 1, defaultTarget: { mode: 'current' }, routes: [], updatedAtMs: 1 },
  });
  assert.deepEqual(updates, []);

  const triggers = ['OpenClaw', 'JunQi'];
  emit({ type: 'triggers', snapshot: { triggers } });
  assert.deepEqual(updates, [['OpenClaw', 'JunQi']]);
  triggers.push('mutated event payload');
  assert.deepEqual(updates, [['OpenClaw', 'JunQi']]);

  release();
  emit({ type: 'triggers', snapshot: { triggers: ['after release'] } });
  assert.equal(unsubscribed, 1);
  assert.deepEqual(updates, [['OpenClaw', 'JunQi']]);
});
