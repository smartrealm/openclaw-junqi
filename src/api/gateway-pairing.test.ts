import assert from 'node:assert/strict';
import test from 'node:test';
import {
  persistGatewayToken,
  pollGatewayPairing,
  requestGatewayPairing,
} from './gateway-pairing';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('desktop pairing calls the Gateway HTTP API and validates its response', async () => {
  let requestedUrl = '';
  let requestBody: Record<string, unknown> = {};
  const result = await requestGatewayPairing('http://127.0.0.1:18789', 'win32', async (input, init) => {
    requestedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return jsonResponse({ code: ' 123456 ', deviceId: ' device-1 ' });
  });

  assert.equal(requestedUrl, 'http://127.0.0.1:18789/v1/pair');
  assert.equal(requestBody.platform, 'win32');
  assert.deepEqual(result, { code: '123456', deviceId: 'device-1' });
  await assert.rejects(
    requestGatewayPairing('http://127.0.0.1:18789', 'win32', async () => jsonResponse({ code: '', deviceId: 'x' })),
    /invalid pairing response/,
  );
});

test('pairing polling encodes the device id and rejects malformed status', async () => {
  let requestedUrl = '';
  const result = await pollGatewayPairing('https://gateway.example/base', 'device/a', async (input) => {
    requestedUrl = String(input);
    return jsonResponse({ status: 'approved', token: ' token ' });
  });

  assert.equal(requestedUrl, 'https://gateway.example/base/v1/pair/device%2Fa/status');
  assert.deepEqual(result, { status: 'approved', token: 'token' });
  await assert.rejects(
    pollGatewayPairing('https://gateway.example', 'x', async () => jsonResponse({})),
    /invalid pairing status/,
  );
});

test('pairing token persistence preserves other desktop settings', () => {
  const values = new Map<string, string>([['aegis-config', JSON.stringify({ gatewayUrl: 'ws://host' })]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  persistGatewayToken(' paired-token ', storage);
  assert.deepEqual(JSON.parse(values.get('aegis-config') ?? '{}'), {
    gatewayUrl: 'ws://host',
    gatewayToken: 'paired-token',
  });
  assert.throws(() => persistGatewayToken('   ', storage), /cannot be empty/);
});
