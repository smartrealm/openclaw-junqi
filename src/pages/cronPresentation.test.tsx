import assert from 'node:assert/strict';
import test from 'node:test';
import { getCronTemplates } from './cronPresentation';

test('Cron templates derive their timezone at creation instead of using a fixed timezone', () => {
  const templates = getCronTemplates((key) => key, 'Asia/Tokyo');

  assert.equal(templates[0]?.job.schedule.kind, 'cron');
  assert.deepEqual(templates[0]?.job.schedule, { kind: 'cron', expr: '0 6 * * *', tz: 'Asia/Tokyo' });
  assert.equal(templates[1]?.job.schedule.kind, 'cron');
  assert.deepEqual(templates[1]?.job.schedule, { kind: 'cron', expr: '0 20 * * 5', tz: 'Asia/Tokyo' });
});
