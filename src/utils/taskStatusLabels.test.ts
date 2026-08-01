import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { LABELLED_STATUSES, resolveStatusLabel, taskStatusLabelKey } from './taskStatusLabels';

const LOCALES = ['zh', 'zh-TW', 'en'] as const;
const bundle = (locale: string) => JSON.parse(readFileSync(`src/locales/${locale}.json`, 'utf8'));
const echo = (key: string) => key;

test('every named status resolves to a key', () => {
  for (const status of LABELLED_STATUSES) {
    assert.equal(taskStatusLabelKey(status), `taskStatus.${status}`);
  }
});

// An upstream vocabulary change must surface as an untranslated status, never
// as a confident but wrong label.
test('an unknown status falls back to itself instead of being invented', () => {
  assert.equal(taskStatusLabelKey('not_a_status'), null);
  assert.equal(resolveStatusLabel('not_a_status', echo), 'not_a_status');
  assert.equal(resolveStatusLabel('running', echo), 'taskStatus.running');
});

test('all three locales cover the full vocabulary', () => {
  for (const locale of LOCALES) {
    const statuses = bundle(locale).taskStatus;
    assert.ok(statuses, `${locale} is missing the taskStatus namespace`);
    for (const status of LABELLED_STATUSES) {
      assert.equal(typeof statuses[status], 'string', `${locale} is missing taskStatus.${status}`);
      assert.ok(statuses[status].length > 0, `${locale} has an empty taskStatus.${status}`);
    }
  }
});

// The regression this replaces: ActivityCenter, TimelinePage and the dynamic
// island each carried a private table, so one status could read differently
// depending on which surface showed it.
test('no surface keeps a private status table', () => {
  for (const file of ['src/pages/ActivityCenter.tsx', 'src/pages/TimelinePage.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /resolveStatusLabel\(/, `${file} should use the shared vocabulary`);
    assert.doesNotMatch(source, /input_required:\s*'/, `${file} still declares its own status labels`);
    assert.doesNotMatch(source, /awaiting_review:\s*'/, `${file} still declares its own status labels`);
  }
});

test('the authoritative task statuses are all covered', () => {
  const store = readFileSync('src/stores/agentWorkspaceStore.ts', 'utf8');
  const union = store.slice(store.indexOf('export type AgentWorkspaceTaskStatus'));
  const declared = [...union.slice(0, union.indexOf(';')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(declared.length >= 10);
  for (const status of declared) {
    assert.ok(
      LABELLED_STATUSES.includes(status as (typeof LABELLED_STATUSES)[number]),
      `AgentWorkspaceTaskStatus '${status}' has no label`,
    );
  }
});
