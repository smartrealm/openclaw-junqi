import assert from 'node:assert/strict';
import test from 'node:test';
import { checkTaskBrief } from './checker';
import { compileTaskBrief } from './compiler';
import type { TaskBrief } from './domain';

const promptLabels = {
  task: 'Task',
  untitled: 'Untitled task',
  project: 'Project',
  references: 'Context references',
  sections: {
    goal: 'Goal',
    background: 'Background',
    constraint: 'Constraints',
    acceptance: 'Acceptance criteria',
    note: 'Notes',
  },
};

const brief = (patch: Partial<TaskBrief> = {}): TaskBrief => ({
  id: 'brief-1',
  title: 'Improve gateway recovery',
  projectPath: '/repo/junqi',
  status: 'draft',
  cards: [
    { id: 'goal', kind: 'goal', content: 'Make gateway recovery deterministic' },
    { id: 'context', kind: 'background', content: 'Current retries can overlap' },
    { id: 'constraint', kind: 'constraint', content: 'Do not switch runtime implicitly' },
    { id: 'accept', kind: 'acceptance', content: 'A concurrent recovery regression test passes' },
    { id: 'empty', kind: 'note', content: '   ' },
  ],
  references: [{ id: 'ref-1', kind: 'file', label: 'Coordinator', value: 'src/services/gateway/GatewayLifecycleCoordinator.ts' }],
  agent: 'codex',
  permissionMode: 'ask',
  planMode: true,
  launchMode: 'local',
  createdAt: 1,
  updatedAt: 2,
  ...patch,
});

test('brief checker blocks missing execution essentials and warns about ambiguity', () => {
  const findings = checkTaskBrief(brief({ projectPath: '', cards: [
    { id: 'g', kind: 'goal', content: '把它优化一下' },
  ] }));
  assert.ok(findings.some((item) => item.code === 'project-required' && item.severity === 'error'));
  assert.ok(findings.some((item) => item.code === 'acceptance-required' && item.severity === 'error'));
  assert.ok(findings.some((item) => item.code === 'ambiguous-language' && item.severity === 'warning'));
});

test('archived briefs are blocked and incomplete references remain visible warnings', () => {
  const findings = checkTaskBrief(brief({
    status: 'archived',
    references: [{ id: 'partial', kind: 'file', label: 'Only a label', value: '' }],
  }));
  assert.ok(findings.some((item) => item.code === 'brief-archived' && item.severity === 'error'));
  assert.ok(findings.some((item) => item.code === 'reference-incomplete' && item.severity === 'warning'));
});

test('valid brief compiles stable markdown in reading order and excludes empty cards', () => {
  assert.deepEqual(checkTaskBrief(brief()).filter((item) => item.severity === 'error'), []);
  const output = compileTaskBrief(brief(), promptLabels);
  assert.match(output, /^# Task: Improve gateway recovery/m);
  assert.match(output, /## Goal\nMake gateway recovery deterministic/);
  assert.match(output, /## Acceptance criteria\n- \[ \] A concurrent recovery regression test passes/);
  assert.match(output, /\[file\] Coordinator - src\/services\/gateway\/GatewayLifecycleCoordinator\.ts/);
  assert.doesNotMatch(output, /## Notes/);
  assert.equal(output, compileTaskBrief(brief(), promptLabels));
});

test('keeps a collaboration run as explicit metadata instead of reading or expanding it', () => {
  const output = compileTaskBrief(brief({
    references: [{
      id: 'ref-collaboration',
      kind: 'collaboration-run',
      label: 'Release review',
      value: 'run:release-review-42',
    }],
  }), promptLabels);

  assert.match(output, /\[collaboration-run\] Release review - run:release-review-42/);
});

test('prompt labels are caller-owned while the compiled structure remains stable', () => {
  const localized = compileTaskBrief(brief(), {
    ...promptLabels,
    task: 'Work item',
    project: 'Repository',
    references: 'Explicit references',
  });
  assert.match(localized, /^# Work item: Improve gateway recovery/m);
  assert.match(localized, /## Repository\n\/repo\/junqi/);
  assert.match(localized, /## Explicit references/);
});
