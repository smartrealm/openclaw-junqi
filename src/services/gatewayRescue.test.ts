import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gatewayRescueTargetKey, type GatewayRescueTarget } from './gatewayRescue';

test('gateway rescue target identity is the authoritative OpenClaw model reference', () => {
  const target: GatewayRescueTarget = {
    providerId: 'vllm',
    modelId: 'gpt-5.6-sol',
    modelRef: 'vllm/gpt-5.6-sol',
    source: 'primary',
  };
  assert.equal(gatewayRescueTargetKey(target), 'vllm/gpt-5.6-sol');
});

test('gateway rescue IPC never accepts provider credentials from the renderer', () => {
  const source = readFileSync(new URL('./gatewayRescue.ts', import.meta.url), 'utf8');
  assert.match(source, /listGatewayRescueTargets/);
  assert.match(source, /gatewayRescueChat/);
  assert.match(source, /modelRef: target\.modelRef/);
  assert.doesNotMatch(source, /apiKey|baseUrl|credentialSource|RescueProviderApi/);
});
