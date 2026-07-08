// ── TimelineView.test.tsx ──────────────────────────────────────────────────────
// Unit tests for the shared TimelineView component.
// Run with: pnpm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { TimelineViewContent, type TimelineTask } from './TimelineView';

const NOW = Date.parse('2026-06-22T10:00:00Z');
const ONE_DAY = 24 * 60 * 60 * 1000;

function task(overrides: Partial<TimelineTask> = {}): TimelineTask {
  return {
    id: 'task-1',
    title: 'Default task',
    createdAt: NOW,
    status: 'done',
    ...overrides,
  };
}

function render(tasks: TimelineTask[], props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(TimelineViewContent, { tasks, now: new Date(NOW), ...props }),
  );
}

test('renders empty state when no tasks', () => {
  const html = render([]);
  assert.match(html, /No tasks in the past 7 days/);
});

test('renders empty state with custom empty message', () => {
  const html = render([], { emptyMessage: 'Nothing here yet.' });
  assert.match(html, /Nothing here yet\./);
});

test('renders custom title + subtitle when provided', () => {
  const html = render([], {
    title: 'My Timeline',
    subtitle: 'A subtitle line',
  });
  assert.match(html, /My Timeline/);
  assert.match(html, /A subtitle line/);
});

test('groups tasks by today / yesterday / earlier', () => {
  const tasks: TimelineTask[] = [
    task({ id: 't1', title: 'today-marker', createdAt: NOW }),
    task({ id: 't2', title: 'yesterday-marker', createdAt: NOW - ONE_DAY }),
    task({ id: 't3', title: 'earlier-marker', createdAt: NOW - 3 * ONE_DAY }),
    // 8-day-old task is outside the 7-day cutoff — should be excluded.
    task({ id: 't4', title: 'too-old-marker', createdAt: NOW - 8 * ONE_DAY }),
  ];
  const html = render(tasks);
  // Bucket labels render
  assert.match(html, />Today</);
  assert.match(html, />Yesterday</);
  assert.match(html, />Earlier</);
  // Task markers render
  assert.match(html, /today-marker/);
  assert.match(html, /yesterday-marker/);
  assert.match(html, /earlier-marker/);
  // Out-of-window task is excluded
  assert.doesNotMatch(html, /too-old-marker/);
});

test('sorts tasks within a bucket by createdAt descending', () => {
  const tasks: TimelineTask[] = [
    task({ id: 'older', createdAt: NOW - 2 * 60 * 60 * 1000, title: 'older' }),
    task({ id: 'newest', createdAt: NOW, title: 'newest' }),
    task({ id: 'middle', createdAt: NOW - 60 * 60 * 1000, title: 'middle' }),
  ];
  const html = render(tasks);
  const idxNewest = html.indexOf('newest');
  const idxMiddle = html.indexOf('middle');
  const idxOlder = html.indexOf('older');
  assert.ok(idxNewest >= 0 && idxMiddle >= 0 && idxOlder >= 0, 'all tasks rendered');
  assert.ok(idxNewest < idxMiddle, 'newest before middle');
  assert.ok(idxMiddle < idxOlder, 'middle before older');
});

test('hides empty buckets (no "Yesterday" label when none)', () => {
  // Only a today task — Yesterday bucket should not appear.
  const html = render([task({ id: 'only-today', createdAt: NOW })]);
  assert.match(html, /Today/);
  assert.doesNotMatch(html, /Yesterday/);
  assert.doesNotMatch(html, /Earlier/);
});

test('renders diff additions / deletions when present', () => {
  const html = render([
    task({ id: 'diff-task', createdAt: NOW, additions: 12, deletions: 5 }),
  ]);
  // Match the diff chip text, not Tailwind class names.
  assert.match(html, />\s*\+12\s*</);
  assert.match(html, />\s*−5\s*</);
});

test('omits diff when additions + deletions are zero', () => {
  const html = render([
    task({ id: 'no-diff', createdAt: NOW, additions: 0, deletions: 0 }),
  ]);
  // The `+N / -M` chip shouldn't render. Use a marker that wouldn't
  // collide with Tailwind utility classes (`shrink-0` etc).
  assert.doesNotMatch(html, />\s*\+0\s*</);
  assert.doesNotMatch(html, />\s*−0\s*</);
});

test('shows agent + project meta when both set', () => {
  const html = render([
    task({ id: 'meta', createdAt: NOW, agent: 'claude', project: 'junqi' }),
  ]);
  assert.match(html, /claude/);
  assert.match(html, /junqi/);
});

test('does not crash when given a future-dated task', () => {
  // Sanity: a task with createdAt > now should still render (categorized
  // as "today" since the boundary is in UTC). We just check it renders.
  const html = render([
    task({ id: 'future', title: 'future-task-marker', createdAt: NOW + 3 * ONE_DAY }),
  ]);
  assert.match(html, /future-task-marker/);
  assert.match(html, /Today/);
});
