import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArgumentCompletions,
  buildMentionItems,
  buildUserMessageHistory,
  parseGatewaySkills,
} from './composerSuggestionDomain';

test('gateway skill parsing keeps only eligible user-invocable skills', () => {
  assert.deepEqual(parseGatewaySkills({ skills: [
    { name: 'ready', userInvocable: true, eligible: true },
    { name: 'disabled', userInvocable: true, eligible: true, disabled: true },
    { name: 'internal', userInvocable: false, eligible: true },
  ] }), [{ name: 'ready', description: undefined }]);
});

test('mention completion combines filtered skills and workspace files', () => {
  assert.deepEqual(buildMentionItems('read', [
    { name: 'reader', description: 'Read documents' },
  ], [
    { name: 'README.md', path: 'docs/README.md' },
  ]).map((item) => item.kind), ['skill', 'file']);
});

test('model argument completion is derived from the gateway catalog', () => {
  assert.deepEqual(buildArgumentCompletions('/model', 'fast', [
    { id: 'provider/fast-model', label: 'Fast model' },
    { id: 'provider/other', label: 'Other' },
  ]), [{ value: 'provider/fast-model', label: 'Fast model' }]);
});

test('input history is newest-first and de-duplicated', () => {
  assert.deepEqual(buildUserMessageHistory([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'first' },
    { role: 'user', content: 'latest' },
  ]), ['latest', 'first']);
});
