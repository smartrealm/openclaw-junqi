export type OpenClawCronListRequester = (
  method: 'cron.list',
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface OpenClawCronListPage extends Record<string, unknown> {
  readonly jobs: readonly unknown[];
  readonly snapshotRevision: string;
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
}

const PAGE_LIMIT = 200;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`cron.list returned an invalid ${field}`);
  }
  return Number(value);
}

function parsePage(value: unknown, expectedOffset: number): OpenClawCronListPage {
  const response = record(value);
  if (!response || !Array.isArray(response.jobs)) {
    throw new Error('cron.list returned an invalid response');
  }
  const snapshotRevision = typeof response.snapshotRevision === 'string'
    ? response.snapshotRevision.trim()
    : '';
  const total = requiredInteger(response.total, 'total');
  const offset = requiredInteger(response.offset, 'offset');
  const limit = requiredInteger(response.limit, 'limit');
  if (!snapshotRevision || limit < 1 || limit > PAGE_LIMIT || offset !== expectedOffset) {
    throw new Error('cron.list returned invalid pagination metadata');
  }
  if (response.jobs.length > limit || offset > total || offset + response.jobs.length > total) {
    throw new Error('cron.list returned invalid pagination metadata');
  }
  if (response.hasMore !== true && response.hasMore !== false) {
    throw new Error('cron.list returned no pagination state');
  }
  const nextOffset = response.nextOffset;
  const expectedNextOffset = offset + response.jobs.length;
  const expectedHasMore = expectedNextOffset < total;
  if (
    response.hasMore !== expectedHasMore
    || nextOffset !== (expectedHasMore ? expectedNextOffset : null)
  ) {
    throw new Error('cron.list returned invalid pagination metadata');
  }
  return {
    ...response,
    jobs: response.jobs,
    snapshotRevision,
    total,
    offset,
    limit,
    hasMore: expectedHasMore,
    nextOffset: expectedHasMore ? expectedNextOffset : null,
  };
}

/**
 * 读取同一 OpenClaw Cron 列表快照的全部页面。快照修订发生变化时不拼接跨版本数据，
 * 由调用方保留此前的已确认投影并等待下一次官方刷新。
 */
export async function listAllOpenClawCronJobs(
  request: OpenClawCronListRequester,
): Promise<OpenClawCronListPage> {
  const jobs: unknown[] = [];
  let offset = 0;
  let snapshotRevision: string | null = null;
  let firstPage: OpenClawCronListPage | null = null;
  let total = 0;

  while (true) {
    const page = parsePage(await request('cron.list', {
      includeDisabled: true,
      limit: PAGE_LIMIT,
      offset,
    }), offset);
    if (snapshotRevision !== null && page.snapshotRevision !== snapshotRevision) {
      throw new Error('cron.list snapshot changed during pagination');
    }
    snapshotRevision = page.snapshotRevision;
    firstPage ??= page;
    total = page.total;
    jobs.push(...page.jobs);
    if (!page.hasMore) break;
    offset = page.nextOffset!;
  }

  if (!firstPage || jobs.length !== total) {
    throw new Error('cron.list pagination did not return the declared job count');
  }
  return {
    ...firstPage,
    jobs,
    total,
    offset: 0,
    limit: PAGE_LIMIT,
    hasMore: false,
    nextOffset: null,
  };
}
