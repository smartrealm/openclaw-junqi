import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArtifactsDownloadParams,
  buildArtifactsListParams,
  parseArtifactDownloadResult,
  parseArtifactGetResult,
  parseArtifactsListResult,
} from './artifacts';

const summary = {
  id: 'artifact_1',
  type: 'file',
  title: 'report.md',
  mimeType: 'text/markdown',
  sizeBytes: 9,
  sessionKey: 'agent:main:main',
  messageSeq: 4,
  source: 'session-transcript',
  download: { mode: 'bytes' },
} as const;

test('artifacts builders keep the official query selector explicit', () => {
  assert.deepEqual(
    buildArtifactsListParams({ sessionKey: ' agent:main:main ', agentId: ' main ' }),
    { sessionKey: 'agent:main:main', agentId: 'main' },
  );
  assert.deepEqual(
    buildArtifactsDownloadParams(' artifact_1 ', { taskId: ' task-1 ' }),
    { artifactId: 'artifact_1', taskId: 'task-1' },
  );
  assert.throws(() => buildArtifactsListParams({}), /requires sessionKey, runId, or taskId/);
});

test('artifacts list and get parsers enforce the requested session and id', () => {
  assert.deepEqual(parseArtifactsListResult({ artifacts: [summary] }, 'agent:main:main').artifacts, [summary]);
  assert.deepEqual(parseArtifactGetResult({ artifact: summary }, 'artifact_1', 'agent:main:main'), {
    artifact: summary,
  });
  assert.throws(
    () => parseArtifactsListResult({ artifacts: [{ ...summary, sessionKey: 'agent:other:main' }] }, 'agent:main:main'),
    /outside the requested session/,
  );
  assert.throws(() => parseArtifactGetResult({ artifact: summary }, 'artifact_2'), /different artifact/);
});

test('artifacts download parser accepts only official bytes or safe URL results', () => {
  assert.deepEqual(
    parseArtifactDownloadResult(
      { artifact: summary, encoding: 'base64', data: 'IyBoZWxsbyE=' },
      'artifact_1',
      'agent:main:main',
    ),
    { artifact: summary, encoding: 'base64', data: 'IyBoZWxsbyE=' },
  );
  const urlSummary = { ...summary, download: { mode: 'url' } } as const;
  assert.deepEqual(
    parseArtifactDownloadResult(
      { artifact: urlSummary, url: '/api/artifacts/artifact_1' },
      'artifact_1',
    ),
    { artifact: urlSummary, url: '/api/artifacts/artifact_1' },
  );
  assert.throws(
    () => parseArtifactDownloadResult({ artifact: urlSummary, url: 'file:///etc/passwd' }, 'artifact_1'),
    /unsafe URL/,
  );
  assert.throws(
    () => parseArtifactDownloadResult({ artifact: summary, encoding: 'base64', data: 'not base64!' }, 'artifact_1'),
    /invalid base64/,
  );
});
