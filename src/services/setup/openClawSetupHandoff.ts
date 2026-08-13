export interface OpenClawSetupHandoffPorts {
  captureAttestedConnectionId: () => string | null;
  isAttestedConnectionCurrent: (connectionId: string) => boolean;
  reconnect: () => Promise<{ success: boolean; diagnostic?: string }>;
  probeSelectedGateway: () => Promise<boolean>;
  detectSetup: () => Promise<{ setupComplete: boolean }>;
  verifyModel: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

export type OpenClawSetupHandoffResult =
  | { ready: true }
  | {
    ready: false;
    reason:
      | "connection-unavailable"
      | "gateway-unavailable"
      | "setup-incomplete"
      | "model-unverified";
    diagnostic?: string;
  };

/**
 * OpenClaw 持有配置语义，JunQi 只在官方流程终态后依次核验认证连接、所选
 * Runtime、配置完成状态与真实模型。任何一步失败都停留在交接阶段，不重放向导。
 */
export async function performOpenClawSetupHandoff(
  ports: OpenClawSetupHandoffPorts,
): Promise<OpenClawSetupHandoffResult> {
  // 官方配置会在当前已认证连接中提交结果。仅当该连接已经失效时才重连，
  // 避免强制制造新连接并把无变化的健康连接误判为超时。
  let connectionId = ports.captureAttestedConnectionId();
  if (!connectionId) {
    const connection = await ports.reconnect();
    if (!connection.success) {
      return {
        ready: false,
        reason: "connection-unavailable",
        ...(connection.diagnostic ? { diagnostic: connection.diagnostic } : {}),
      };
    }
    connectionId = ports.captureAttestedConnectionId();
    if (!connectionId) return { ready: false, reason: "connection-unavailable" };
  }

  if (!(await ports.probeSelectedGateway())) {
    return { ready: false, reason: "gateway-unavailable" };
  }
  if (!ports.isAttestedConnectionCurrent(connectionId)) {
    return { ready: false, reason: "connection-unavailable" };
  }

  const detection = await ports.detectSetup();
  if (!ports.isAttestedConnectionCurrent(connectionId)) {
    return { ready: false, reason: "connection-unavailable" };
  }
  if (!detection.setupComplete) {
    return { ready: false, reason: "setup-incomplete" };
  }

  const verification = await ports.verifyModel();
  if (!ports.isAttestedConnectionCurrent(connectionId)) {
    return { ready: false, reason: "connection-unavailable" };
  }
  if (!verification.ok) {
    return {
      ready: false,
      reason: "model-unverified",
      diagnostic: verification.error,
    };
  }

  return { ready: true };
}
