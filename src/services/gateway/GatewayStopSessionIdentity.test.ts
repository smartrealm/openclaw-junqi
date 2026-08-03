import assert from 'node:assert/strict';
import test from 'node:test';
import { taskExecutionCoordinator } from '@/task-execution/TaskExecutionCoordinator';
import { gateway } from './index';

test('passes the active session identity to the local Stop checkpoint before native abort', async () => {
  const originalRequestStop = taskExecutionCoordinator.requestStop;
  const calls: Array<{ sessionKey: string; sessionId: string | undefined }> = [];
  taskExecutionCoordinator.requestStop = async (sessionKey, sessionId) => {
    calls.push({ sessionKey, sessionId });
  };

  try {
    await assert.rejects(
      gateway.abortChat('agent:main:identity-test', 'session-current'),
      /Gateway is not connected/,
    );
    assert.deepEqual(calls, [{
      sessionKey: 'agent:main:identity-test',
      sessionId: 'session-current',
    }]);
  } finally {
    taskExecutionCoordinator.requestStop = originalRequestStop;
  }
});
