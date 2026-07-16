import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chat = readFileSync(new URL('./GatewayRescueChat.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./GatewaySelfRescuePanel.tsx', import.meta.url), 'utf8');

test('AI rescue exposes a real model selector and credential source', () => {
  assert.match(chat, /const MANUAL_TARGET_KEY/);
  assert.match(chat, /value=\{selectedTargetKey\}/);
  assert.match(chat, /<option value=\{MANUAL_TARGET_KEY\}>/);
  assert.doesNotMatch(chat, /targets\.length > 1 \?/);
  assert.match(chat, /gatewayRescueTargetKey\(item\)/);
  assert.match(chat, /appearance-none/);
  assert.match(chat, /<ChevronDown/);
  assert.match(chat, /gatewayRescue\.credentialLabel/);
});

test('AI rescue invalidates an old response after a model switch or panel unmount', () => {
  assert.match(chat, /const mountedRef = useRef\(false\)/);
  assert.match(chat, /const requestIdRef = useRef\(0\)/);
  assert.match(chat, /requestIdRef\.current \+= 1/);
  assert.match(chat, /if \(!isCurrentRequest\(\)\) return/);
  assert.match(chat, /setMessages\(\[\]\)/);
});

test('AI rescue keeps temporary config collapsed after request failures', () => {
  const sendStart = chat.indexOf('const send =');
  const catchStart = chat.indexOf('} catch (err: any) {', sendStart);
  const finallyStart = chat.indexOf('} finally {', catchStart);
  const catchBlock = chat.slice(catchStart, finallyStart);
  assert.doesNotMatch(catchBlock, /setManualOpen\(true\)/);
  assert.match(chat, /classifyGatewayRescueFailure/);
  assert.match(chat, /role="alert"/);
});

test('AI rescue replaces the parent controls instead of nesting another large panel', () => {
  assert.match(panel, /!showAiRescue && <div className="space-y-2/);
  assert.match(panel, /max-h-\[min\(560px,70vh\)\]/);
  assert.doesNotMatch(chat, /gatewayRescue\.subtitle/);
});

test('AI rescue ignores an obsolete repair completion after its panel unmounts', () => {
  assert.match(panel, /const mountedRef = useRef\(false\)/);
  assert.match(panel, /const repairRunRef = useRef\(0\)/);
  assert.match(panel, /repairRunRef\.current \+= 1/);
  assert.match(panel, /if \(!isCurrentRepairRun\(\)\) return/);
  assert.match(panel, /window\.clearTimeout\(resetTimerRef\.current\)/);
});
