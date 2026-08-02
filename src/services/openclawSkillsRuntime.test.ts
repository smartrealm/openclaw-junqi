import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOpenClawSkillsRuntime,
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
