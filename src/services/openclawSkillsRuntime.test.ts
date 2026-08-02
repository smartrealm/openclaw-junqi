import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOpenClawSkillsRuntime,
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
