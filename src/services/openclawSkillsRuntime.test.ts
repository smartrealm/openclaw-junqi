import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOpenClawSkillsRuntime,
  OpenClawSkillCardUnsupportedError,
  OpenClawSkillCuratorUnsupportedError,
  SKILL_ARCHIVE_CHUNK_BYTES,
  normalizeOpenClawSkillCard,
  normalizeOpenClawSkillCuratorStatus,
  normalizeOpenClawSkillDetail,
  normalizeOpenClawSkillSearch,
  normalizeOpenClawSkillSecurityVerdicts,
  normalizeOpenClawSkills,
} from './openclawSkillsRuntime';

test('normalizes OpenClaw skill status without accepting malformed entries', () => {
  assert.deepEqual(normalizeOpenClawSkills({
    skills: [
      { skillKey: 'weather', name: 'Weather', description: 'Forecast', disabled: false, eligible: true, userInvocable: true, source: 'openclaw-managed', baseDir: '/skills/weather', clawhub: { status: 'linked', valid: true, installedVersion: '1.2.0' } },
      { skillKey: 'disabled', name: 'Disabled', description: '', disabled: true, eligible: false, userInvocable: false, source: 'openclaw-managed' },
      { skillKey: '' },
      { skillKey: 'missing-flags', name: 'Missing flags', description: 'Invalid', source: 'openclaw-managed' },
      { skillKey: 'invalid-description', name: 'Invalid description', description: 42, disabled: false, eligible: true, userInvocable: true, source: 'openclaw-managed' },
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
  }, {
    key: 'disabled',
    name: 'Disabled',
    description: '',
    enabled: false,
    eligible: false,
    userInvocable: false,
    source: 'openclaw-managed',
  }]);
});

test('normalizes only documented Gateway catalog fields', () => {
  assert.deepEqual(normalizeOpenClawSkillSearch({
    results: [
      { score: 0.9, slug: 'weather', displayName: 'Weather', summary: 'Forecast', version: '1.0.0', updatedAt: 1 },
      { score: 1, slug: 'missing-name' },
      { slug: 'missing-score', displayName: 'Missing score' },
      { score: '0.5', slug: 'invalid-score', displayName: 'Invalid score' },
    ],
  }), [{ score: 0.9, slug: 'weather', displayName: 'Weather', summary: 'Forecast', version: '1.0.0', updatedAt: 1 }]);
  assert.deepEqual(normalizeOpenClawSkillDetail({
    skill: {
      slug: 'weather',
      displayName: 'Weather',
      summary: 'Forecast',
      isOfficial: true,
      tags: { category: 'utility' },
      channel: 'stable',
      createdAt: 1,
      updatedAt: 2,
    },
    latestVersion: { version: '1.1.0', createdAt: 3, changelog: 'Improved forecasts' },
    metadata: { os: ['darwin', 'linux'], systems: ['node'] },
    owner: { displayName: 'OpenClaw', official: true, channel: 'clawhub' },
  }), {
    slug: 'weather',
    displayName: 'Weather',
    summary: 'Forecast',
    tags: { category: 'utility' },
    channel: 'stable',
    isOfficial: true,
    createdAt: 1,
    updatedAt: 2,
    latestVersion: { version: '1.1.0', createdAt: 3, changelog: 'Improved forecasts' },
    metadata: { os: ['darwin', 'linux'], systems: ['node'] },
    owner: { displayName: 'OpenClaw', official: true, channel: 'clawhub' },
  });
});

test('rejects malformed native skill detail fields instead of inventing defaults', () => {
  assert.equal(normalizeOpenClawSkillDetail({
    skill: { slug: 'weather', displayName: 'Weather', createdAt: 1, updatedAt: 2, isOfficial: 'yes' },
  }), null);
  assert.equal(normalizeOpenClawSkillDetail({
    skill: { slug: 'weather', displayName: 'Weather', createdAt: 1, updatedAt: 2 },
    latestVersion: { version: '1.0.0' },
  }), null);
});

test('preserves documented nullable native detail fields', () => {
  assert.deepEqual(normalizeOpenClawSkillDetail({
    skill: { slug: 'weather', displayName: 'Weather', createdAt: 1, updatedAt: 2, isOfficial: null },
    latestVersion: null,
    metadata: null,
    owner: null,
  }), {
    slug: 'weather',
    displayName: 'Weather',
    isOfficial: null,
    createdAt: 1,
    updatedAt: 2,
    latestVersion: null,
    metadata: null,
    owner: null,
  });
});

test('normalizes only the documented native skill-card envelope', () => {
  assert.deepEqual(normalizeOpenClawSkillCard({
    schema: 'openclaw.skills.skill-card.v1',
    skillKey: 'weather',
    path: '/workspace/skills/weather/skill-card.md',
    sizeBytes: 32,
    content: '# Weather\n\nLocal trust card.\n',
  }, 'weather'), {
    skillKey: 'weather',
    sizeBytes: 32,
    content: '# Weather\n\nLocal trust card.\n',
  });
  assert.equal(normalizeOpenClawSkillCard({
    schema: 'openclaw.skills.skill-card.v1',
    skillKey: 'other-skill',
    path: '/workspace/skills/other-skill/skill-card.md',
    sizeBytes: 1,
    content: 'x',
  }, 'weather'), null);
  assert.equal(normalizeOpenClawSkillCard({
    schema: 'openclaw.skills.skill-card.v1',
    skillKey: 'weather',
    path: '/workspace/skills/weather/skill-card.md',
    sizeBytes: -1,
    content: 'x',
  }, 'weather'), null);
});

test('normalizes only the complete documented native curator status', () => {
  const status = {
    lastAttemptAtMs: 10,
    lastSuccessAtMs: 9,
    lastError: null,
    counts: { active: 1, stale: 0, archived: 0 },
    skills: [{
      skillFile: '/workspace/skills/weather/SKILL.md',
      skillKey: 'weather',
      skillName: 'Weather',
      state: 'active',
      pinned: false,
      createdAtMs: 1,
      stateChangedAtMs: 2,
      lastUsedAtMs: null,
      useCount: 3,
      archivedReason: null,
    }],
    overlaps: [{ left: 'weather', right: 'forecast', score: 0.8 }],
  };
  assert.deepEqual(normalizeOpenClawSkillCuratorStatus(status), status);
  assert.equal(normalizeOpenClawSkillCuratorStatus({
    ...status,
    skills: [{ ...status.skills[0], state: 'unknown' }],
  }), null);
  assert.equal(normalizeOpenClawSkillCuratorStatus({
    ...status,
    overlaps: [{ left: 'weather', right: 'forecast', score: '0.8' }],
  }), null);
});

test('normalizes the native security verdict envelope without inventing verdicts', () => {
  assert.deepEqual(normalizeOpenClawSkillSecurityVerdicts({
    schema: 'openclaw.skills.security-verdicts.v1',
    items: [
      {
        registry: 'https://clawhub.ai',
        ok: true,
        decision: 'allow',
        reasons: ['verified'],
        requestedSlug: 'weather',
        requestedVersion: '1.2.0',
        slug: 'weather',
        version: '1.2.0',
        displayName: 'Weather',
        createdAt: 1,
        checkedAt: 2,
        securityStatus: 'clean',
        securityPassed: true,
      },
      {
        registry: 'https://clawhub.ai',
        ok: false,
        decision: 'review',
        reasons: [],
        requestedSlug: 'untrusted',
        requestedVersion: 'latest',
        slug: null,
        version: null,
        displayName: null,
        publisherHandle: null,
        publisherDisplayName: null,
        createdAt: null,
        checkedAt: null,
        skillUrl: null,
        securityAuditUrl: null,
        securityStatus: null,
        securityPassed: null,
        error: { code: 'REVIEW_REQUIRED', message: 'Manual review required.' },
      },
      {
        registry: 'https://clawhub.ai',
        ok: true,
        decision: 'bad',
        reasons: [],
        requestedSlug: 'malformed',
        requestedVersion: '1.0.0',
        securityPassed: 'true',
      },
    ],
  }), [{
    registry: 'https://clawhub.ai',
    ok: true,
    decision: 'allow',
    reasons: ['verified'],
    requestedSlug: 'weather',
    requestedVersion: '1.2.0',
    slug: 'weather',
    version: '1.2.0',
    displayName: 'Weather',
    createdAt: 1,
    checkedAt: 2,
    securityStatus: 'clean',
    securityPassed: true,
  }, {
    registry: 'https://clawhub.ai',
    ok: false,
    decision: 'review',
    reasons: [],
    requestedSlug: 'untrusted',
    requestedVersion: 'latest',
    slug: null,
    version: null,
    displayName: null,
    publisherHandle: null,
    publisherDisplayName: null,
    createdAt: null,
    checkedAt: null,
    skillUrl: null,
    securityAuditUrl: null,
    securityStatus: null,
    securityPassed: null,
    error: { code: 'REVIEW_REQUIRED', message: 'Manual review required.' },
  }]);
  assert.deepEqual(normalizeOpenClawSkillSecurityVerdicts({
    schema: 'unknown',
    items: [],
  }), []);
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
  await runtime.securityVerdicts();

  assert.deepEqual(calls, [
    { privileged: true, method: 'skills.update', params: { skillKey: 'weather', enabled: false } },
    { privileged: true, method: 'skills.install', params: { source: 'clawhub', slug: 'weather', version: '1.0.0' } },
    { privileged: false, method: 'skills.search', params: { query: 'weather', limit: 20 } },
    { privileged: false, method: 'skills.securityVerdicts', params: {} },
  ]);
});

test('reads an installed skill card through the read-only Gateway method', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runtime = createOpenClawSkillsRuntime({
    async call(method, params = {}) {
      calls.push({ method, params });
      return {
        schema: 'openclaw.skills.skill-card.v1',
        skillKey: 'weather',
        path: '/workspace/skills/weather/skill-card.md',
        sizeBytes: 28,
        content: '# Weather\n\nTrust card.\n',
      };
    },
    async callPrivileged() {
      return { ok: true };
    },
    hasAdvertisedMethod(method) {
      return method === 'skills.skillCard';
    },
  });

  assert.equal(runtime.skillCardCapability(), true);
  assert.deepEqual(await runtime.skillCard(' weather '), {
    skillKey: 'weather',
    sizeBytes: 28,
    content: '# Weather\n\nTrust card.\n',
  });
  assert.deepEqual(calls, [{ method: 'skills.skillCard', params: { skillKey: 'weather' } }]);
});

test('does not request skill cards that the Gateway explicitly does not advertise', async () => {
  let calls = 0;
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      calls += 1;
      return {};
    },
    async callPrivileged() {
      return { ok: true };
    },
    hasAdvertisedMethod() {
      return false;
    },
  });

  assert.equal(runtime.skillCardCapability(), false);
  await assert.rejects(runtime.skillCard('weather'), OpenClawSkillCardUnsupportedError);
  assert.equal(calls, 0);
});

test('reads curator status through the read-only Gateway method', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const runtime = createOpenClawSkillsRuntime({
    async call(method, params = {}) {
      calls.push({ method, params });
      return {
        lastAttemptAtMs: null,
        lastSuccessAtMs: 9,
        lastError: null,
        counts: { active: 1, stale: 0, archived: 0 },
        skills: [],
        overlaps: [],
      };
    },
    async callPrivileged() {
      return { ok: true };
    },
    hasAdvertisedMethod(method) {
      return method === 'skills.curator.status';
    },
  });

  assert.equal(runtime.curatorStatusCapability(), true);
  assert.deepEqual(await runtime.curatorStatus(), {
    lastAttemptAtMs: null,
    lastSuccessAtMs: 9,
    lastError: null,
    counts: { active: 1, stale: 0, archived: 0 },
    skills: [],
    overlaps: [],
  });
  assert.deepEqual(calls, [{ method: 'skills.curator.status', params: {} }]);
});

test('does not request curator status that the Gateway explicitly does not advertise', async () => {
  let calls = 0;
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      calls += 1;
      return {};
    },
    async callPrivileged() {
      return { ok: true };
    },
    hasAdvertisedMethod() {
      return false;
    },
  });

  assert.equal(runtime.curatorStatusCapability(), false);
  await assert.rejects(runtime.curatorStatus(), OpenClawSkillCuratorUnsupportedError);
  assert.equal(calls, 0);
});

test('does not claim archive upload support when Gateway advertisement is explicit', () => {
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged() {
      return { ok: true };
    },
    hasAdvertisedMethod(method) {
      return method === 'skills.upload.begin' || method === 'skills.upload.chunk'
        ? true
        : false;
    },
  });

  assert.equal(runtime.archiveUploadCapability(), false);
});

test('keeps archive upload capability unknown when Gateway does not advertise a methods list', () => {
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged() {
      return { ok: true };
    },
  });

  assert.equal(runtime.archiveUploadCapability(), null);
});

test('uploads a skill archive in bounded chunks and installs only after hash confirmation', async () => {
  const bytes = new Uint8Array(SKILL_ARCHIVE_CHUNK_BYTES + 5);
  bytes.fill(65);
  const uploadId = '123e4567-e89b-12d3-a456-426614174000';
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const progress: string[] = [];
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      calls.push({ method, params });
      if (method === 'skills.upload.begin') {
        return { uploadId, receivedBytes: 0, expiresAt: 9_999 };
      }
      if (method === 'skills.upload.chunk') {
        const chunkSize = Buffer.from(params.dataBase64 as string, 'base64').byteLength;
        return { uploadId: params.uploadId, receivedBytes: (params.offset as number) + chunkSize, expiresAt: 9_999 };
      }
      if (method === 'skills.upload.commit') {
        return { uploadId: params.uploadId, receivedBytes: bytes.length, sha256: params.sha256, expiresAt: 9_999 };
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
  assert.equal(calls[3].params.uploadId, uploadId);
  assert.equal(calls[3].params.sha256, calls[0].params.sha256);
  assert.equal(calls[4].params.source, 'upload');
  assert.deepEqual(progress, ['starting', 'uploading', 'uploading', 'committing', 'installing']);
});

test('rejects an upload when Gateway returns an unexpected chunk offset', async () => {
  const uploadId = '123e4567-e89b-12d3-a456-426614174000';
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method) {
      if (method === 'skills.upload.begin') return { uploadId, receivedBytes: 0, expiresAt: 9_999 };
      if (method === 'skills.upload.chunk') return { uploadId, receivedBytes: 0, expiresAt: 9_999 };
      throw new Error(`unexpected ${method}`);
    },
  });

  await assert.rejects(
    runtime.installArchive({ slug: 'local-skill', bytes: new Uint8Array([1, 2, 3]) }),
    /unexpected upload offset/,
  );
});

test('does not accept a malformed installed archive hash', async () => {
  const uploadId = '123e4567-e89b-12d3-a456-426614174000';
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(method, params = {}) {
      if (method === 'skills.upload.begin') return { uploadId, receivedBytes: 0, expiresAt: 9_999 };
      if (method === 'skills.upload.chunk') return { uploadId, receivedBytes: 1, expiresAt: 9_999 };
      if (method === 'skills.upload.commit') return { uploadId, receivedBytes: 1, sha256: params.sha256, expiresAt: 9_999 };
      return { ok: true, slug: 'local-skill', sha256: 'not-a-sha256' };
    },
  });

  await assert.rejects(
    runtime.installArchive({ slug: 'local-skill', bytes: new Uint8Array([1]) }),
    /different installed skill archive hash/,
  );
});

test('rejects invalid skill archive slugs before opening a privileged upload', async () => {
  let calls = 0;
  const runtime = createOpenClawSkillsRuntime({
    async call() {
      return { results: [] };
    },
    async callPrivileged(_method, _params = {}) {
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
