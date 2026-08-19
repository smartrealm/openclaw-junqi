import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cacheDwsOperationFinished,
  cacheDwsOperationOutput,
  type DwsOperationEventCache,
} from './dwsOperationEventCache';

test('DWS 终态早于启动响应时保留输出与终态', () => {
  const cache: DwsOperationEventCache = { output: {}, finished: {} };
  const output = cacheDwsOperationOutput(cache, {
    operationId: 'dws-1',
    stream: 'status',
    line: 'DWS 安装命令已启动。',
  }, 'DWS 安装命令已启动。');
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
  assert.equal(cache.finished['dws-1'], finished);
});
