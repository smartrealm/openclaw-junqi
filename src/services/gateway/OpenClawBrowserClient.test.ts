import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError, GatewayRpcError } from './Connection';
import {
  OPENCLAW_BROWSER_REQUEST_METHOD,
  OpenClawBrowserClient,
  OpenClawBrowserResponseError,
  OpenClawBrowserUnavailableError,
  parseOpenClawBrowserProfiles,
  parseOpenClawBrowserStatus,
  parseOpenClawBrowserTabs,
} from './OpenClawBrowserClient';

const status = {
  profile: 'openclaw',
  running: true,
  cdpReady: true,
  pageReady: true,
  driver: 'openclaw',
  detectedBrowser: 'chrome',
};

test('OpenClawBrowserClient uses only browser.request HTTP proxy fields', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; timeout?: number }> = [];
  const client = new OpenClawBrowserClient({
    request: async <T>(method: string, params: Record<string, unknown>, timeout?: number) => {
      calls.push({ method, params, timeout });
      return status as T;
    },
  });

  const result = await client.start(' openclaw ');
  assert.deepEqual(result, status);
  assert.deepEqual(calls, [
    {
      method: OPENCLAW_BROWSER_REQUEST_METHOD,
      params: { method: 'POST', path: '/start', query: { profile: 'openclaw' }, timeoutMs: 45_000 },
      timeout: 45_000,
    },
    {
      method: OPENCLAW_BROWSER_REQUEST_METHOD,
      params: { method: 'GET', path: '/', query: { profile: 'openclaw' } },
      timeout: undefined,
    },
  ]);
});

test('OpenClawBrowserClient validates URLs and browser control paths', async () => {
  const client = new OpenClawBrowserClient({ request: async <T>() => ({}) as T });
  await assert.rejects(client.openTab('file:///private/data'), /HTTP or HTTPS/);
  await assert.rejects(client.request({ method: 'GET', path: '../tabs' }), /absolute control route/);
});

test('OpenClawBrowserClient maps authoritative unavailable states without inventing a browser response', async () => {
  const unsupported = new OpenClawBrowserClient({
    request: async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    },
  });
  const disconnected = new OpenClawBrowserClient({
    request: async () => { throw new GatewayDisconnectedError(); },
  });
  await assert.rejects(unsupported.status(), (error: unknown) => error instanceof OpenClawBrowserUnavailableError
    && error.code === 'OPENCLAW_BROWSER_UNSUPPORTED');
  await assert.rejects(disconnected.status(), (error: unknown) => error instanceof OpenClawBrowserUnavailableError
    && error.code === 'OPENCLAW_BROWSER_CONNECTION_UNAVAILABLE');
});

test('OpenClawBrowserClient rejects malformed response shapes', () => {
  assert.throws(() => parseOpenClawBrowserStatus({ ...status, running: 'true' }), OpenClawBrowserResponseError);
  assert.throws(() => parseOpenClawBrowserProfiles({ profiles: [{ name: 'openclaw' }] }), OpenClawBrowserResponseError);
  assert.throws(() => parseOpenClawBrowserTabs({ tabs: [{ title: 'Untitled' }] }), OpenClawBrowserResponseError);
});
