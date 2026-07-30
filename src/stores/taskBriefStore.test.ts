import assert from 'node:assert/strict';
import test from 'node:test';
import { useTaskBriefStore } from './taskBriefStore';

function reset() {
  useTaskBriefStore.setState({ briefs: [], selectedBriefId: null });
}

test('task brief cards preserve stable identity while editing and reordering', () => {
  reset();
  const brief = useTaskBriefStore.getState().createBrief();
  const [goal, acceptance] = brief.cards;
  useTaskBriefStore.getState().updateCard(brief.id, goal.id, { content: 'A real goal' });
  useTaskBriefStore.getState().moveCard(brief.id, acceptance.id, -1);
  const stored = useTaskBriefStore.getState().briefs[0];
  assert.deepEqual(stored.cards.map((card) => card.id), [acceptance.id, goal.id]);
  assert.equal(stored.cards.find((card) => card.id === goal.id)?.content, 'A real goal');
});

test('launched brief keeps its handoff identity', () => {
  reset();
  const brief = useTaskBriefStore.getState().createBrief();
  useTaskBriefStore.getState().markLaunched(brief.id, 'task-1');
  const stored = useTaskBriefStore.getState().briefs[0];
  assert.equal(stored.status, 'launched');
  assert.equal(stored.launchedTaskId, 'task-1');
});

test('execution edits recompute readiness and invalidate a previous handoff', () => {
  reset();
  const brief = useTaskBriefStore.getState().createBrief();
  const goal = brief.cards.find((card) => card.kind === 'goal')!;
  const acceptance = brief.cards.find((card) => card.kind === 'acceptance')!;
  useTaskBriefStore.getState().updateBrief(brief.id, { projectPath: '/repo' });
  useTaskBriefStore.getState().updateCard(brief.id, goal.id, { content: 'Implement the feature' });
  useTaskBriefStore.getState().updateCard(brief.id, acceptance.id, { content: 'Tests pass' });
  assert.equal(useTaskBriefStore.getState().briefs[0].status, 'ready');

  useTaskBriefStore.getState().markLaunched(brief.id, 'task-1');
  useTaskBriefStore.getState().updateBrief(brief.id, { title: 'Revised task' });
  const revised = useTaskBriefStore.getState().briefs[0];
  assert.equal(revised.status, 'ready');
  assert.equal(revised.launchedTaskId, undefined);
});

test('archived briefs restore their prior executable state', () => {
  reset();
  const brief = useTaskBriefStore.getState().createBrief();
  const goal = brief.cards.find((card) => card.kind === 'goal')!;
  const acceptance = brief.cards.find((card) => card.kind === 'acceptance')!;
  useTaskBriefStore.getState().updateBrief(brief.id, { projectPath: '/repo' });
  useTaskBriefStore.getState().updateCard(brief.id, goal.id, { content: 'Goal' });
  useTaskBriefStore.getState().updateCard(brief.id, acceptance.id, { content: 'Acceptance' });
  useTaskBriefStore.getState().setBriefArchived(brief.id, true);
  assert.equal(useTaskBriefStore.getState().briefs[0].status, 'archived');
  useTaskBriefStore.getState().setBriefArchived(brief.id, false);
  assert.equal(useTaskBriefStore.getState().briefs[0].status, 'ready');
});

test('duplicate card identities are rejected without changing the brief', () => {
  reset();
  const brief = useTaskBriefStore.getState().createBrief();
  const before = useTaskBriefStore.getState().briefs[0];
  useTaskBriefStore.getState().addCard(brief.id, { ...brief.cards[0], content: 'Duplicate' });
  const after = useTaskBriefStore.getState().briefs[0];
  assert.equal(after.cards.length, before.cards.length);
  assert.equal(after.updatedAt, before.updatedAt);
});

test('persisted briefs fail closed when text bounds or identities are invalid', async () => {
  const invalidBrief = {
    id: '',
    title: 'Invalid',
    projectPath: '/repo',
    status: 'draft',
    cards: [],
    references: [],
    agent: 'codex',
    permissionMode: 'ask',
    planMode: true,
    launchMode: 'local',
    createdAt: 1,
    updatedAt: 1,
  };
  localStorage.setItem('junqi:task-briefs:v1', JSON.stringify({
    state: { briefs: [invalidBrief], selectedBriefId: invalidBrief.id },
    version: 1,
  }));
  await useTaskBriefStore.persist.rehydrate();
  assert.deepEqual(useTaskBriefStore.getState().briefs, []);
  assert.equal(useTaskBriefStore.getState().selectedBriefId, null);
});
