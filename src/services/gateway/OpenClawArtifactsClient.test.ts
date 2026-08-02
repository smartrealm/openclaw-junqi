import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawArtifactsClient,
  OpenClawArtifactsResponseError,
  parseOpenClawArtifactsDownloadResult,
  parseOpenClawArtifactsListResult,
} from './OpenClawArtifactsClient';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'artifact-1',
    type: 'file',
    title: 'report.txt',
    mimeType: 'text/plain',
    sizeBytes: 12,
    sessionKey: 'agent:main:main',
    messageSeq: 3,
    source: 'session-transcript',
    download: { mode: 'bytes' },
    ...overrides,
  };
}

test('sends official artifact scopes and decodes list, get and download results', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawArtifactsClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    if (method === 'artifacts.list') return { artifacts: [summary()] } as T;
    if (method === 'artifacts.get') return { artifact: summary() } as T;
    return {
      artifact: summary(),
      encoding: 'base64',
      data: 'aGVsbG8=',
      expiresAt: '2026-08-03T00:00:00.000Z',
    } as T;
  });

  assert.deepEqual(await client.list({ sessionKey: ' agent:main:main ', agentId: ' main ' }), {
    artifacts: [summary()],
  });
  assert.deepEqual(await client.get({ sessionKey: 'agent:main:main', artifactId: ' artifact-1 ' }), {
    artifact: summary(),
  });
  assert.deepEqual(await client.download({ sessionKey: 'agent:main:main', artifactId: 'artifact-1' }), {
    artifact: summary(),
    encoding: 'base64',
    data: 'aGVsbG8=',
    expiresAt: '2026-08-03T00:00:00.000Z',
  });
  assert.deepEqual(calls, [
    { method: 'artifacts.list', params: { sessionKey: 'agent:main:main', agentId: 'main' } },
    { method: 'artifacts.get', params: { sessionKey: 'agent:main:main', artifactId: 'artifact-1' } },
    { method: 'artifacts.download', params: { sessionKey: 'agent:main:main', artifactId: 'artifact-1' } },
  ]);
});

test('preserves official download modes and ignores additive fields', () => {
  assert.deepEqual(parseOpenClawArtifactsListResult({
    artifacts: [
      summary({ id: 'bytes', download: { mode: 'bytes' } }),
      summary({ id: 'url', download: { mode: 'url' }, urlHint: 'ignored' }),
      summary({ id: 'unsupported', download: { mode: 'unsupported' } }),
    ],
    futureField: true,
  }), {
    artifacts: [
      summary({ id: 'bytes', download: { mode: 'bytes' } }),
      summary({ id: 'url', download: { mode: 'url' } }),
      summary({ id: 'unsupported', download: { mode: 'unsupported' } }),
    ],
  });
  assert.deepEqual(parseOpenClawArtifactsDownloadResult({
    artifact: summary({ download: { mode: 'url' } }),
    url: 'https://gateway.example/artifact-1',
    futureField: { accepted: true },
  }), {
    artifact: summary({ download: { mode: 'url' } }),
    url: 'https://gateway.example/artifact-1',
  });
});

test('rejects malformed known fields, duplicate artifact ids and unscoped requests', async () => {
  for (const value of [
    { artifacts: [summary({ id: '' })] },
    { artifacts: [summary({ download: { mode: 'other' } })] },
    { artifacts: [summary(), summary()] },
    { artifacts: [summary({ sizeBytes: -1 })] },
    { artifacts: [summary({ messageSeq: 0 })] },
    { artifacts: [summary({ sessionKey: '' })] },
  ]) {
    assert.throws(() => parseOpenClawArtifactsListResult(value), OpenClawArtifactsResponseError);
  }

  const client = new OpenClawArtifactsClient(async <T>(): Promise<T> => ({ artifacts: [] }) as T);
  await assert.rejects(client.list({}));
  await assert.rejects(client.get({ artifactId: 'artifact-1' }));
  await assert.rejects(client.download({ sessionKey: 'agent:main:main', artifactId: ' ' }));
  assert.throws(() => parseOpenClawArtifactsDownloadResult({
    artifact: summary(),
    encoding: 'hex',
  }), OpenClawArtifactsResponseError);
  assert.throws(() => parseOpenClawArtifactsDownloadResult({
    artifact: summary(),
    url: '',
  }), OpenClawArtifactsResponseError);
});
