import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chat = readFileSync(new URL('./GatewayRescueChat.tsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('./GatewaySelfRescuePanel.tsx', import.meta.url), 'utf8');
const disclosure = readFileSync(new URL('./GatewayAiDiagnosticDisclosure.tsx', import.meta.url), 'utf8');
const setupProgress = readFileSync(new URL('../pages/SetupPage/ProgressScreen.tsx', import.meta.url), 'utf8');

test('AI diagnostics enumerate OpenClaw models without renderer credentials', () => {
  assert.match(chat, /loadGatewayRescueTargets/);
  assert.match(chat, /gatewayRescueTargetKey\(item\)/);
  assert.match(chat, /appearance-none/);
  assert.match(chat, /<ChevronDown/);
  assert.match(chat, /gatewayRescue\.credentialOpenClaw/);
  assert.doesNotMatch(chat, /manualApiKey|manualBaseUrl|buildManualGatewayRescueTarget/);
});

test('AI rescue invalidates an old response after a model switch or panel unmount', () => {
  assert.match(chat, /const mountedRef = useRef\(false\)/);
  assert.match(chat, /const requestIdRef = useRef\(0\)/);
  assert.match(chat, /requestIdRef\.current \+= 1/);
  assert.match(chat, /if \(!isCurrentRequest\(\)\) return/);
  assert.match(chat, /setMessages\(\[\]\)/);
});

test('AI diagnostics surface authoritative OpenClaw failures', () => {
  assert.match(chat, /gatewayRescue\.sendFailedForTarget/);
  assert.match(chat, /role="alert"/);
  assert.doesNotMatch(chat, /classifyGatewayRescueFailure|authFailed|permissionFailed/);
});

test('runtime and first-run failures share one AI diagnostic disclosure', () => {
  assert.match(disclosure, /<GatewayRescueChat/);
  assert.match(panel, /<GatewayAiDiagnosticDisclosure/);
  assert.match(setupProgress, /setupStep === "error"/);
  assert.match(setupProgress, /<GatewayAiDiagnosticDisclosure/);
});

test('AI rescue ignores an obsolete repair completion after its panel unmounts', () => {
  assert.match(panel, /const mountedRef = useRef\(false\)/);
  assert.match(panel, /const repairRunRef = useRef\(0\)/);
  assert.match(panel, /repairRunRef\.current \+= 1/);
  assert.match(panel, /if \(!isCurrentRepairRun\(\)\) return/);
  assert.match(panel, /window\.clearTimeout\(resetTimerRef\.current\)/);
});
