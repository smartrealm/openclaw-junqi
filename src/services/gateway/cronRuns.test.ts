import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCronRunsParams,
  CronRunWaitTimeoutError,
  enqueueCronRun,
  getCronJob,
  listCronRuns,
  parseCronJobDetails,
  parseCronRunsPage,
  waitForCronRun,
} from './cronRuns';

const job = {
  id: 'job-1',
  name: 'Daily report',
  enabled: true,
  createdAtMs: 1_754_000_000_000,
  updatedAtMs: 1_754_000_001_000,
  configRevision: 'revision-1',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai', staggerMs: 0 },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Generate the report', model: 'provider/model' },
  state: { nextRunAtMs: 1_754_000_100_000, lastRunStatus: 'ok', lastDurationMs: 1500 },
} as const;

const finishedRun = {
  ts: 1_754_000_010_000,
  jobId: 'job-1',
  action: 'finished',
  status: 'ok',
  summary: 'Report generated',
  runId: 'manual:job-1:1',
  runAtMs: 1_754_000_000_000,
  durationMs: 1500,
  deliveryStatus: 'not-requested',
} as const;

const page = {
  entries: [finishedRun],
  total: 1,
  offset: 0,
  limit: 1,
  hasMore: false,
  nextOffset: null,
};

test('projects cron.get into a safe typed job detail without retaining payload content', () => {
  const parsed = parseCronJobDetails(job);
  assert.equal(parsed.id, 'job-1');
  assert.equal(parsed.payloadKind, 'agentTurn');
  assert.equal(parsed.configRevision, 'revision-1');
  assert.deepEqual(parsed.schedule, job.schedule);
  assert.equal('payload' in parsed, false);
});

test('projects the current automation schedule, payload, delivery, and failure policy fields', () => {
  const parsed = parseCronJobDetails({
    ...job,
    schedule: {
      kind: 'stream',
      command: ['node', 'watch.mjs'],
      mode: 'match',
      match: '^ready$',
      batchMs: 250,
      maxBatchBytes: 4096,
    },
    pacing: { min: '10s', max: '2m' },
    payload: { kind: 'script', script: 'echo ready' },
    delivery: {
      mode: 'announce',
      channel: 'telegram',
      to: 'channel-1',
      threadId: 7,
      accountId: 'primary',
      bestEffort: true,
      failureDestination: { mode: 'webhook', to: 'https://example.invalid/failure' },
    },
    failureAlert: { after: 3, cooldownMs: 60_000, includeSkipped: true, mode: 'announce' },
    state: {
      ...job.state,
      streamStatus: 'running',
      lastFailureNotificationDeliveryStatus: 'not-requested',
    },
  });

  assert.deepEqual(parsed.schedule, {
    kind: 'stream',
    command: ['node', 'watch.mjs'],
    mode: 'match',
    match: '^ready$',
    batchMs: 250,
    maxBatchBytes: 4096,
  });
  assert.equal(parsed.payloadKind, 'script');
  assert.deepEqual(parsed.pacing, { min: '10s', max: '2m' });
  assert.deepEqual(parsed.delivery, {
    mode: 'announce',
    channel: 'telegram',
    to: 'channel-1',
    threadId: 7,
    accountId: 'primary',
    bestEffort: true,
    failureDestination: { mode: 'webhook', to: 'https://example.invalid/failure' },
  });
  assert.deepEqual(parsed.failureAlert, { after: 3, cooldownMs: 60_000, includeSkipped: true, mode: 'announce' });
  assert.equal(parsed.state.streamStatus, 'running');
});

test('fails closed when cron.get or cron.runs violates the official response shape', () => {
  assert.throws(() => parseCronJobDetails({ ...job, state: undefined }), /state/);
  assert.throws(() => parseCronJobDetails({ ...job, schedule: { kind: 'cron' } }), /schedule\.expr/);
  assert.throws(() => parseCronJobDetails({ ...job, configRevision: '' }), /configRevision/);
  assert.throws(() => parseCronRunsPage({ ...page, entries: [{ ...finishedRun, action: 'started' }] }), /action/);
  assert.throws(() => parseCronRunsPage({ ...page, nextOffset: -1 }), /nextOffset/);
});

test('builds job-scoped cron.runs params and clamps the page size', () => {
  assert.deepEqual(buildCronRunsParams({ jobId: ' job-1 ', runId: ' run-1 ', limit: 999, sortDir: 'asc' }), {
    scope: 'job',
    id: 'job-1',
    runId: 'run-1',
    limit: 200,
    sortDir: 'asc',
  });
});

test('uses exact official envelopes for cron.get, cron.runs, and cron.run', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === 'cron.get') return job;
    if (method === 'cron.runs') return page;
    return { ok: true, enqueued: true, runId: 'manual:job-1:1' };
  };

  await getCronJob(request, 'job-1');
  await listCronRuns(request, { jobId: 'job-1', limit: 5 });
  await enqueueCronRun(request, 'job-1');

  assert.deepEqual(calls, [
    { method: 'cron.get', params: { id: 'job-1' } },
    { method: 'cron.runs', params: { scope: 'job', id: 'job-1', limit: 5 } },
    { method: 'cron.run', params: { id: 'job-1', mode: 'force' } },
  ]);
});

test('reports an invalid cron.get response without classifying a transport failure', async () => {
  const invalidMethods: string[] = [];
  await assert.rejects(
    () => getCronJob(async () => ({ ...job, state: undefined }), 'job-1', (method) => invalidMethods.push(method)),
    /state/,
  );
  assert.deepEqual(invalidMethods, ['cron.get']);
});

test('waits for the exact runId instead of accepting another recent run', async () => {
  let polls = 0;
  const requestedRunIds: string[] = [];
  const result = await waitForCronRun(
    async (method, params) => {
      assert.equal(method, 'cron.runs');
      requestedRunIds.push(String(params.runId));
      polls += 1;
      return polls === 1
        ? { ...page, entries: [{ ...finishedRun, runId: 'another-run' }] }
        : page;
    },
    'job-1',
    'manual:job-1:1',
    { timeoutMs: 100, pollIntervalMs: 1, sleep: async () => {} },
  );
  assert.equal(result.runId, 'manual:job-1:1');
  assert.deepEqual(requestedRunIds, ['manual:job-1:1', 'manual:job-1:1']);
});

test('reports a bounded timeout when the exact run is never recorded', async () => {
  let clock = 0;
  await assert.rejects(
    () => waitForCronRun(
      async () => ({ ...page, entries: [] }),
      'job-1',
      'missing-run',
      { timeoutMs: 3, pollIntervalMs: 1, now: () => clock++, sleep: async () => {} },
    ),
    (error: unknown) => error instanceof CronRunWaitTimeoutError && error.runId === 'missing-run',
  );
});
