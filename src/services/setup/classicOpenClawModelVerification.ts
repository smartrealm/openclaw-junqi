import { parseOpenClawAgentList } from '@/services/gateway/OpenClawSessionProjection';

const MODEL_PROBE_TIMEOUT_MS = 90_000;

interface ClassicOpenClawModelVerificationPorts {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (
    method: string,
    params: Record<string, unknown>,
    connectionId: string,
  ) => Promise<unknown>;
  requestPrivileged: (
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<unknown>;
  cleanupSession: (sessionKey: string) => Promise<void>;
  createId?: () => string;
}

interface AgentAcceptedResult {
  runId: string;
  sessionKey: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAcceptedAgentRun(value: unknown, expectedSessionKey: string): AgentAcceptedResult {
  const result = record(value);
  const runId = nonEmptyText(result?.runId);
  const sessionKey = nonEmptyText(result?.sessionKey);
  if (!result || result.status !== 'accepted' || !runId || sessionKey !== expectedSessionKey) {
    throw new Error('OpenClaw did not accept the setup model verification run');
  }
  return { runId, sessionKey };
}

function assertSuccessfulAgentRun(value: unknown, expectedRunId: string): void {
  const result = record(value);
  if (nonEmptyText(result?.runId) !== expectedRunId || result?.status !== 'ok') {
    throw new Error('OpenClaw model verification did not complete successfully');
  }
}

/**
 * 旧版 Classic Wizard 没有只读完成探针，因此只在首次启动核验中运行一个隔离会话，
 * 等待官方 agent 终态后立即删除会话。响应正文不会进入 JunQi 状态或日志。
 */
export async function verifyClassicOpenClawModel(
  ports: ClassicOpenClawModelVerificationPorts,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const connectionId = ports.captureConnectionId();
  if (!connectionId || !ports.isConnectionCurrent(connectionId)) {
    return { ok: false, error: 'No attested Gateway connection is available for model verification' };
  }

  let sessionKey: string | null = null;
  try {
    const id = ports.createId ? ports.createId() : globalThis.crypto.randomUUID();
    const agents = parseOpenClawAgentList(await ports.requestFenced(
      'agents.list',
      {},
      connectionId,
    ));
    if (!ports.isConnectionCurrent(connectionId)) {
      throw new Error('Gateway connection changed before model verification');
    }

    sessionKey = `agent:${agents.defaultId}:junqi-setup-probe-${id}`;
    const accepted = parseAcceptedAgentRun(await ports.requestPrivileged(
      'agent',
      {
        message: 'Reply with exactly OK.',
        agentId: agents.defaultId,
        sessionKey,
        deliver: false,
        idempotencyKey: `junqi-setup-probe-${id}`,
      },
      MODEL_PROBE_TIMEOUT_MS,
    ), sessionKey);
    if (!ports.isConnectionCurrent(connectionId)) {
      throw new Error('Gateway connection changed during model verification');
    }
    const terminal = await ports.requestPrivileged(
      'agent.wait',
      { runId: accepted.runId, timeoutMs: MODEL_PROBE_TIMEOUT_MS },
      MODEL_PROBE_TIMEOUT_MS + 5_000,
    );
    if (!ports.isConnectionCurrent(connectionId)) {
      throw new Error('Gateway connection changed during model verification');
    }
    assertSuccessfulAgentRun(terminal, accepted.runId);
  } catch (error) {
    if (sessionKey) {
      try {
        await ports.cleanupSession(sessionKey);
      } catch {
        // 原始模型核验错误优先，清理失败不能覆盖真实失败原因。
      }
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    await ports.cleanupSession(sessionKey);
  } catch (error) {
    return {
      ok: false,
      error: `OpenClaw model verification session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { ok: true };
}
