import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chat = readFileSync(new URL('./GatewayRescueChat.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./GatewaySelfRescuePanel.tsx', import.meta.url), 'utf8');

test('AI rescue exposes a real model selector and credential source', () => {
  assert.match(chat, /targets\.length > 1/);
  assert.match(chat, /gatewayRescueTargetKey\(item\)/);
  assert.match(chat, /appearance-none/);
  assert.match(chat, /<ChevronDown/);
  assert.match(chat, /gatewayRescue\.credentialLabel/);
});

test('AI rescue keeps temporary config collapsed after request failures', () => {
  const catchBlock = chat.slice(chat.indexOf('} catch (err: any) {', chat.indexOf('const send =')));
  assert.doesNotMatch(catchBlock, /setManualOpen\(true\)/);
  assert.match(chat, /classifyGatewayRescueFailure/);
  assert.match(chat, /role="alert"/);
});

test('AI rescue replaces the parent controls instead of nesting another large panel', () => {
  assert.match(panel, /!showAiRescue && <div className="space-y-2/);
  assert.match(panel, /max-h-\[min\(560px,70vh\)\]/);
  assert.doesNotMatch(chat, /gatewayRescue\.subtitle/);
});
