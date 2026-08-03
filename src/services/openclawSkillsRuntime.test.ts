import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOpenClawSkillsRuntime,
  SKILL_ARCHIVE_CHUNK_BYTES,
  normalizeOpenClawSkillDetail,
  normalizeOpenClawSkillSearch,
  normalizeOpenClawSkills,
} from './openclawSkillsRuntime';

test('normalizes OpenClaw skill status without accepting malformed entries', () => {
  assert.deepEqual(normalizeOpenClawSkills({
    skills: [
      { skillKey: 'weather', displayName: 'Weather', description: 'Forecast', enabled: true, eligible: true, userInvocable: true, source: 'openclaw-managed', baseDir: '/skills/weather', version: '1.2.0' },
      { skillKey: '' },
      null,
    ],
  }), [{
    key: 'weather',
    name: 'Weather',
    description: 'Forecast',
    enabled: true,
    eligible: true,
    userInvocable: true,
    source: 'openclaw-managed',
    baseDir: '/skills/weather',
    version: '1.2.0',
  }]);
});

test('normalizes only documented Gateway catalog fields', () => {
  assert.deepEqual(normalizeOpenClawSkillSearch({
    results: [
      { score: 0.9, slug: 'weather', displayName: 'Weather', summary: 'Forecast', version: '1.0.0', updatedAt: 1 },
      { score: 1, slug: 'missing-name' },
    ],
  }), [{ score: 0.9, slug: 'weather', displayName: 'Weather', summary: 'Forecast', version: '1.0.0', updatedAt: 1 }]);
  assert.deepEqual(normalizeOpenClawSkillDetail({
    skill: { slug: 'weather', displayName: 'Weather', summary: 'Forecast', isOfficial: true, createdAt: 1, updatedAt: 2 },
    latestVersion: { version: '1.1.0' },
    owner: { displayName: 'OpenClaw', official: true },
  }), {
    slug: 'weather', displayName: 'Weather', summary: 'Forecast', version: '1.1.0', createdAt: 1, updatedAt: 2,
    official: true, owner: { displayName: 'OpenClaw', official: true },
  });
});

test('uses privileged Gateway calls for every skill mutation', async () => {
  const calls: Array<{ privileged: boolean; method: string; params: Record<string, unknown> }> = [];
  const runtime = createOpenClawSkillsRuntime({
    async call(method, params = {}) {
      calls.push({ privileged: false, method, params });
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      calls.push({ privileged: true, method, params });
      return method === 'skills.install' ? { ok: true, slug: 'weather', version: '1.0.0' } : { ok: true };
    },
  });

  await runtime.setEnabled('weather', false);
  await runtime.installFromClawHub({ slug: 'weather', version: '1.0.0' });
  await runtime.search('weather', 20);

  assert.deepEqual(calls, [
    { privileged: true, method: 'skills.update', params: { skillKey: 'weather', enabled: false } },
    { privileged: true, method: 'skills.install', params: { source: 'clawhub', slug: 'weather', version: '1.0.0' } },
    { privileged: false, method: 'skills.search', params: { query: 'weather', limit: 20 } },
  ]);
});

test('uploads a skill archive in bounded chunks and installs only after hash confirmation', async () => {
  const bytes = new Uint8Array(SKILL_ARCHIVE_CHUNK_BYTES + 5);
  bytes.fill(65);
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const progress: string[] = [];
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      calls.push({ method, params });
      if (method === 'skills.upload.begin') return { uploadId: '123e4567-e89b-12d3-a456-426614174000', receivedBytes: 0, expiresAt: 9_999 };
      if (method === 'skills.upload.chunk') {
        const data = params.dataBase64 as string;
        const receivedBytes = (params.offset as number) + atob(data).length;
        return { uploadId: params.uploadId, receivedBytes, expiresAt: 9_999 };
      }
      if (method === 'skills.upload.commit') {
        return {
          uploadId: params.uploadId,
          receivedBytes: bytes.length,
          sha256: params.sha256,
          expiresAt: 9_999,
        };
      }
      return { ok: true, slug: 'local-skill', sha256: params.sha256, message: 'Installed local-skill' };
    },
  });

  const result = await runtime.installArchive({
    slug: 'local-skill',
    bytes,
    onProgress: ({ phase }) => progress.push(phase),
  });

  assert.equal(result.ok, true);
  assert.equal(result.slug, 'local-skill');
  assert.match(result.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(calls.map(({ method }) => method), [
    'skills.upload.begin',
    'skills.upload.chunk',
    'skills.upload.chunk',
    'skills.upload.commit',
    'skills.install',
  ]);
  assert.equal(calls[1].params.offset, 0);
  assert.equal(calls[2].params.offset, SKILL_ARCHIVE_CHUNK_BYTES);
  assert.equal(calls[3].params.uploadId, calls[1].params.uploadId);
  assert.equal(calls[3].params.sha256, calls[0].params.sha256);
  assert.equal(calls[4].params.source, 'upload');
  assert.deepEqual(progress, ['starting', 'uploading', 'uploading', 'committing', 'installing']);
});

test('rejects an upload when Gateway returns an unexpected chunk offset', async () => {
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      if (method === 'skills.upload.begin') return { uploadId: '123e4567-e89b-12d3-a456-426614174000', receivedBytes: 0, expiresAt: 9_999 };
      if (method === 'skills.upload.chunk') return { uploadId: params.uploadId, receivedBytes: 0, expiresAt: 9_999 };
      throw new Error(`unexpected ${method}`);
    },
  });

  await assert.rejects(
    runtime.installArchive({ slug: 'local-skill', bytes: new Uint8Array([1, 2, 3]) }),
    /unexpected upload offset/,
  );
});

test('does not accept a malformed installed archive hash', async () => {
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      if (method === 'skills.upload.begin') return { uploadId: '123e4567-e89b-12d3-a456-426614174000', receivedBytes: 0, expiresAt: 9_999 };
      if (method === 'skills.upload.chunk') return { uploadId: params.uploadId, receivedBytes: 1, expiresAt: 9_999 };
      if (method === 'skills.upload.commit') return { uploadId: params.uploadId, receivedBytes: 1, sha256: params.sha256, expiresAt: 9_999 };
      return { ok: true, slug: 'local-skill', sha256: 'not-a-sha256' };
    },
  });

  await assert.rejects(
    runtime.installArchive({ slug: 'local-skill', bytes: new Uint8Array([1]) }),
    /invalid installed skill archive hash/,
  );
});

test('rejects invalid skill archive slugs before opening a privileged upload', async () => {
  let calls = 0;
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged() {
      calls += 1;
      return {};
    },
  });

  await assert.rejects(
    runtime.installArchive({ slug: '../unsafe', bytes: new Uint8Array([1]) }),
    /Skill slug is invalid/,
  );
  assert.equal(calls, 0);
});
