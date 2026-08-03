import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AGENT_PROFILE_DOMAIN_MAX_CHARS,
  AGENT_PROFILE_SCOPE_MAX_CHARS,
  normalizeAgentProfileDraft,
} from './agentProfiles';

test('normalizes the local Agent Profile without changing the OpenClaw id', () => {
  assert.deepEqual(
    normalizeAgentProfileDraft({
      agentId: '  research  ',
      domain: '  Research operations  ',
      scope: '  Internal knowledge search and reporting\n  ',
    }),
    {
      agentId: 'research',
      domain: 'Research operations',
      scope: 'Internal knowledge search and reporting',
    },
  );
});

test('allows an empty domain and scope draft so the native command can remove a profile', () => {
  assert.deepEqual(
    normalizeAgentProfileDraft({ agentId: 'research', domain: ' ', scope: '' }),
    { agentId: 'research', domain: '', scope: '' },
  );
});

test('rejects oversized or unsafe profile fields before IPC', () => {
  assert.throws(() => normalizeAgentProfileDraft({
    agentId: 'research',
    domain: 'x'.repeat(AGENT_PROFILE_DOMAIN_MAX_CHARS + 1),
    scope: '',
  }));
  assert.throws(() => normalizeAgentProfileDraft({
    agentId: 'research',
    domain: '',
    scope: 'x'.repeat(AGENT_PROFILE_SCOPE_MAX_CHARS + 1),
  }));
  assert.throws(() => normalizeAgentProfileDraft({ agentId: 'research\n', domain: '', scope: '' }));
});
