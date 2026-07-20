import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentWorkspaceSkills } from './agentWorkspaceSkills';

test('keeps only skills installed in the current agent workspace', () => {
  const result = parseAgentWorkspaceSkills({
    skills: [
      { name: 'legal-agent', source: 'openclaw-workspace', eligible: true, disabled: false },
      { name: 'review-contract', source: 'agents-skills-personal', eligible: true, disabled: false },
      { name: 'weather', source: 'openclaw-bundled', eligible: true, disabled: false },
    ],
  });

  assert.deepEqual(result, [
    { name: 'legal-agent', description: '', eligible: true, disabled: false },
  ]);
});

test('accepts entries responses and removes duplicate workspace skills', () => {
  const result = parseAgentWorkspaceSkills({
    entries: [
      { name: 'writer', source: 'workspace', description: 'Draft content.' },
      { name: 'writer', source: 'openclaw-workspace', description: 'Updated.', eligible: false },
    ],
  });

  assert.deepEqual(result, [
    { name: 'writer', description: 'Updated.', eligible: false, disabled: false },
  ]);
});

test('an explicit agent allowlist selects shared skills and excludes unrelated ones', () => {
  const result = parseAgentWorkspaceSkills({
    agentSkillFilter: ['review-contract'],
    skills: [
      { name: 'review-contract', skillKey: 'review-contract', source: 'agents-skills-personal' },
      { name: 'weather', skillKey: 'weather', source: 'openclaw-bundled' },
      { name: 'local-only', skillKey: 'local-only', source: 'openclaw-workspace' },
    ],
  });

  assert.deepEqual(result.map((skill) => skill.name), ['review-contract']);
});
