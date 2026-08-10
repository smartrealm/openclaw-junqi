import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { listAllOpenClawCronJobs } from './OpenClawCronListClient';

function page(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    jobs: [],
    snapshotRevision: 'snapshot-1',
    total: 0,
    offset: 0,
    limit: 200,
    hasMore: false,
    nextOffset: null,
    ...overrides,
  };
}

describe('listAllOpenClawCronJobs', () => {
  it('读取并合并同一官方快照的全部页面', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const result = await listAllOpenClawCronJobs(async (_method, params) => {
      calls.push(params);
      return params.offset === 0
        ? page({ jobs: [{ id: 'first' }], total: 2, hasMore: true, nextOffset: 1 })
        : page({ jobs: [{ id: 'second' }], total: 2, offset: 1, hasMore: false, nextOffset: null });
    });

    assert.deepEqual(calls, [
      { includeDisabled: true, limit: 200, offset: 0 },
      { includeDisabled: true, limit: 200, offset: 1 },
    ]);
    assert.deepEqual(result.jobs, [{ id: 'first' }, { id: 'second' }]);
    assert.equal(result.total, 2);
  });

  it('拒绝旧数组、分页元数据错误和跨快照拼接', async () => {
    await assert.rejects(listAllOpenClawCronJobs(async () => []), /invalid response/);
    await assert.rejects(
      listAllOpenClawCronJobs(async () => page({ total: 2, hasMore: true, nextOffset: 2 })),
      /pagination metadata/,
    );
    await assert.rejects(
      listAllOpenClawCronJobs(async (_method, params) => (
        params.offset === 0
          ? page({ jobs: [{ id: 'first' }], total: 2, hasMore: true, nextOffset: 1 })
          : page({ jobs: [{ id: 'second' }], total: 2, offset: 1, snapshotRevision: 'snapshot-2' })
      )),
      /snapshot changed/,
    );
  });
});
