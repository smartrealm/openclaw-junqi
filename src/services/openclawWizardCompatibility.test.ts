import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawWizardClient } from './openclawWizard';

function clientReturning(payload: unknown) {
  return new OpenClawWizardClient(async () => payload);
}

const RUNNING = { sessionId: 's1', done: false, status: 'running' as const };

// AUD-01: OpenClaw ships onboarding changes on its own cadence. A field this
// build has never seen must not be able to make first-run setup impossible.
test('an added envelope field no longer breaks the wizard', async () => {
  const result = await clientReturning({
    ...RUNNING,
    step: { id: 'welcome', type: 'note', title: 'Hi' },
    progressPercent: 10,
    warnings: ['upstream note'],
  }).start();
  assert.equal(result.step?.id, 'welcome');
  assert.equal(result.sessionId, 's1');
});

test('an added step field is ignored rather than dropping the step', async () => {
  const result = await clientReturning({
    ...RUNNING,
    step: {
      id: 'pick',
      type: 'select',
      title: 'Pick',
      options: [{ value: 1, label: 'a' }],
      required: true,
      helpUrl: 'https://example.invalid',
    },
  }).start();
  assert.equal(result.step?.id, 'pick');
  assert.equal(result.step?.type, 'select');
  // Unknown keys are dropped, never forwarded as if they were supported.
  assert.equal((result.step as unknown as Record<string, unknown>).required, undefined);
  assert.equal((result.step as unknown as Record<string, unknown>).helpUrl, undefined);
});

// Reporting an unsupported step as "missing" sent the user after the Gateway
// when the actual fix is upgrading the desktop app.
test('an unsupported step type names itself instead of looking like a protocol fault', async () => {
  const error = await clientReturning({
    ...RUNNING,
    step: { id: 'pw', type: 'password', title: 'Token' },
  }).start().catch((e: Error) => e);
  assert.ok(error instanceof Error);
  assert.match(error.message, /does not support/i);
  assert.match(error.message, /`pw`/);
  assert.match(error.message, /`password`/);
  assert.doesNotMatch(error.message, /missing the next step/i);
});

test('a genuinely malformed step is still reported as malformed', async () => {
  for (const step of [{ type: 'note' }, { id: '', type: 'note' }, { id: 'x', type: 'note', title: 42 }]) {
    const error = await clientReturning({ ...RUNNING, step }).start().catch((e: Error) => e);
    assert.ok(error instanceof Error, JSON.stringify(step));
    assert.match(error.message, /missing the next step/i, JSON.stringify(step));
  }
});

// Value checks on fields JunQi acts on must stay strict: relaxing them would
// turn protocol drift into silent misinterpretation.
test('known fields keep their strict value validation', async () => {
  const cases = [
    { id: 'a', type: 'note', format: 'markdown' },
    { id: 'a', type: 'note', executor: 'someone-else' },
    { id: 'a', type: 'select', options: [{ label: 'no value here' }] },
    { id: 'a', type: 'note', sensitive: 'yes' },
  ];
  for (const step of cases) {
    const error = await clientReturning({ ...RUNNING, step }).start().catch((e: Error) => e);
    assert.ok(error instanceof Error, JSON.stringify(step));
    assert.match(error.message, /missing the next step/i, JSON.stringify(step));
  }
});

test('an invalid status is still rejected', async () => {
  const error = await clientReturning({
    ...RUNNING,
    status: 'weird',
    step: { id: 'a', type: 'note' },
  }).start().catch((e: Error) => e);
  assert.ok(error instanceof Error);
  assert.match(error.message, /invalid `status`/);
});
