import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildArgumentCompletions,
  buildMentionItems,
  buildUserMessageHistory,
  parseGatewaySkills,
  replaceCommandArgumentCompletion,
  toComposerSlashCommands,
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

test('slash completion projects only Gateway text aliases and declared static choices', () => {
  const commands = toComposerSlashCommands([
    {
      name: 'weather',
      textAliases: ['/weather', '/forecast'],
      description: 'Get weather.',
      category: 'tools',
      source: 'skill',
      scope: 'text',
      acceptsArgs: true,
      args: [{
        name: 'city',
        description: 'City name.',
        type: 'string',
      }, {
        name: 'unit',
        description: 'Display unit.',
        type: 'string',
        choices: [
          { value: 'metric', label: 'Metric' },
          { value: 'imperial', label: 'Imperial' },
        ],
      }],
    },
    {
      name: 'hidden',
      description: 'Native only.',
      source: 'native',
      scope: 'native',
      acceptsArgs: false,
    },
    {
      name: 'search',
      textAliases: ['/search'],
      description: 'Search.',
      source: 'plugin',
      scope: 'both',
      acceptsArgs: true,
      args: [{ name: 'query', description: 'Search text.', type: 'string', dynamic: true }],
    },
  ]);

  assert.deepEqual(commands.map((command) => command.cmd), ['/weather', '/forecast', '/search']);
  assert.deepEqual(buildArgumentCompletions('/weather', 'met', commands, 1), [
    { value: 'metric', label: 'Metric' },
  ]);
  assert.deepEqual(buildArgumentCompletions('/search', '', commands, 0), []);
  assert.deepEqual(buildArgumentCompletions('/weather', '', commands, 0), []);
  assert.equal(replaceCommandArgumentCompletion({
    text: '/weather city met',
    cursor: '/weather city met'.length,
    command: '/weather',
    argumentIndex: 1,
    value: 'metric',
  }), '/weather city metric ');
});

test('input history is newest-first and de-duplicated', () => {
  assert.deepEqual(buildUserMessageHistory([
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'first' },
    { role: 'user', content: 'latest' },
  ]), ['latest', 'first']);
});
