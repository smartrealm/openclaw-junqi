import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cacheDwsOperationFinished,
  cacheDwsOperationOutput,
  formatDwsOperationOutput,
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
