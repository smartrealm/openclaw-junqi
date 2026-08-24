import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cacheDwsOperationFinished,
  cacheDwsOperationOutput,
  formatDwsOperationOutput,
  releaseDwsOperationCache,
  rememberFinalizedDwsOperation,
  type DwsOperationEventCache,
} from './dwsOperationEventCache';

test('DWS 终态早于启动响应时保留输出与终态', () => {
  const cache: DwsOperationEventCache = { output: {}, events: {}, finished: {} };
  const event = {
    operationId: 'dws-1',
    stream: 'status',
    line: 'DWS 安装命令已启动。',
  } as const;
  const output = cacheDwsOperationOutput(cache, event, 'DWS 安装命令已启动。');
  const finished = {
    operationId: 'dws-1',
    kind: 'install' as const,
    success: false,
    cancelled: false,
    message: 'DWS 官方流程未成功完成',
    dwsPath: null,
  };

  cacheDwsOperationFinished(cache, finished);

  assert.deepEqual(output, ['DWS 安装命令已启动。']);
  assert.deepEqual(cache.events['dws-1'], [event]);
  assert.equal(cache.finished['dws-1'], finished);
});

test('DWS 标准错误流使用中性诊断标记而非业务失败标记', () => {
  const line = formatDwsOperationOutput({
    operationId: 'dws-2',
    stream: 'stderr',
    line: 'Waiting for authorization...',
  }, '[DWS] ');

  assert.equal(line, '[DWS] Waiting for authorization...');
});

test('已结算 DWS 操作释放内部输出、事件与终态缓存', () => {
  const cache: DwsOperationEventCache = { output: {}, events: {}, finished: {} };
  const outputEvent = { operationId: 'dws-3', stream: 'stdout', line: 'done' } as const;
  cacheDwsOperationOutput(cache, outputEvent, 'done');
  cacheDwsOperationFinished(cache, {
    operationId: 'dws-3',
    kind: 'authorize',
    success: true,
    cancelled: false,
    message: 'done',
    dwsPath: null,
  });

  releaseDwsOperationCache(cache, 'dws-3');

  assert.equal(cache.output['dws-3'], undefined);
  assert.equal(cache.events['dws-3'], undefined);
  assert.equal(cache.finished['dws-3'], undefined);
});

test('已结算 operation id 集合保持固定上限', () => {
  const finalized = new Set<string>();
  rememberFinalizedDwsOperation(finalized, 'dws-1', 2);
  rememberFinalizedDwsOperation(finalized, 'dws-2', 2);
  rememberFinalizedDwsOperation(finalized, 'dws-3', 2);

  assert.deepEqual([...finalized], ['dws-2', 'dws-3']);
});
