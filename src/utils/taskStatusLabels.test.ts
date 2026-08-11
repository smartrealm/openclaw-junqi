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

// 上游新增状态必须保留原文，不能显示为客户端虚构的确定标签。
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

// 活动中心和时间线必须使用同一词汇表，避免同一状态在不同页面显示不同名称。
test('no surface keeps a private status table', () => {
  for (const file of ['src/pages/ActivityCenter.tsx', 'src/pages/TimelinePage.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /resolveStatusLabel\(/, `${file} should use the shared vocabulary`);
    assert.doesNotMatch(source, /input_required:\s*'/, `${file} still declares its own status labels`);
    assert.doesNotMatch(source, /awaiting_review:\s*'/, `${file} still declares its own status labels`);
  }
});

test('词汇表不再依赖已删除的本地 AgentRun 状态模型', () => {
  const source = readFileSync('src/utils/taskStatusLabels.ts', 'utf8');
  assert.doesNotMatch(source, /AgentWorkspaceTaskStatus/);
  assert.ok(LABELLED_STATUSES.length > 0);
});
