export interface OpenClawSetupHandoffPorts {
  waitForLifecycleIdle: (
    boundary: OpenClawSetupHandoffBoundary,
  ) => Promise<OpenClawSetupLifecycleReceipt | null>;
  isLifecycleReceiptCurrent: (receipt: OpenClawSetupLifecycleReceipt) => boolean;
  captureAttestedConnectionId: () => string | null;
  isAttestedConnectionCurrent: (connectionId: string) => boolean;
  reconnectSelectedRuntime: (boundary: OpenClawSetupHandoffBoundary) => Promise<{
    success: boolean;
    connectionId?: string;
    diagnostic?: string;
  }>;
  restartSelectedRuntime: (
    boundary: OpenClawSetupHandoffBoundary,
    configRevisionHash: string,
  ) => Promise<{
    success: boolean;
    connectionId?: string;
    diagnostic?: string;
  }>;
  probeSelectedGateway: () => Promise<boolean>;
  readConfigApplication: (connectionId: string) => Promise<{
    configRevisionHash?: string;
    appliedConfigHash?: string | null;
    reloadDisabled?: boolean;
  }>;
  wait?: (delayMs: number) => Promise<void>;
  now?: () => number;
}

export interface OpenClawSetupHandoffBoundary {
  deadline: number;
  signal: AbortSignal;
}

export interface OpenClawSetupLifecycleReceipt {
  generation: number;
  restartAttemptGeneration: number;
  observedRestart: boolean;
}

// OpenClaw 当前会为活动工作保留最长五分钟重启延迟，之后仍需留出连接与身份核验时间。
// JunQi 在此窗口内只等待官方收敛，不能把较短客户端超时当作主动重启依据。
export const OPENCLAW_CONFIG_APPLICATION_TIMEOUT_MS = 360_000;
const OPENCLAW_CONFIG_APPLICATION_POLL_MS = 100;
const OPENCLAW_HANDOFF_VERIFICATION_PASSES = 2;

export type OpenClawSetupCompletionEvidence =
  | {
    kind: "guided";
    detectSetup: () => Promise<{ setupComplete: boolean; configuredModel?: string }>;
    modelEvidence:
      | { kind: "verify-rpc"; verifyModel: () => Promise<{ ok: true } | { ok: false; error: string }> }
      | { kind: "activation"; modelRef: string };
  }
  | { kind: "classic-wizard-terminal" };

export type OpenClawSetupHandoffResult =
  | { ready: true }
  | {
    ready: false;
    reason:
      | "connection-unavailable"
      | "gateway-unavailable"
      | "configuration-application-unavailable"
      | "configuration-application-timeout"
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
  evidence: OpenClawSetupCompletionEvidence,
): Promise<OpenClawSetupHandoffResult> {
  const now = ports.now ?? Date.now;
  const transaction = {
    deadline: now() + OPENCLAW_CONFIG_APPLICATION_TIMEOUT_MS,
    now,
    explicitRestartAttempted: false,
    lifecycleReceipt: null,
    abortController: new AbortController(),
  };
  if (!(await acquireLifecycleReceipt(ports, transaction))) {
    return configurationApplicationTimeout();
  }
  let finalDiagnostic: string | undefined;
  let pass = 0;
  while (pass < OPENCLAW_HANDOFF_VERIFICATION_PASSES) {
    if (!hasHandoffBudget(transaction)) return configurationApplicationTimeout(finalDiagnostic);
    if (!isLifecycleReceiptCurrent(ports, transaction)) {
      if (!(await acquireLifecycleReceipt(ports, transaction))) {
        return configurationApplicationTimeout(finalDiagnostic);
      }
      continue;
    }
    const convergence = await convergeConfigurationApplication(ports, transaction);
    if (!convergence.ready) return convergence;
    if (!hasHandoffBudget(transaction)) return configurationApplicationTimeout(finalDiagnostic);
    const connectionId = convergence.connectionId;
    const revisionHash = convergence.revisionHash;

    const probe = await awaitWithinHandoffDeadline(() => ports.probeSelectedGateway(), transaction);
    if (!probe.settled) return configurationApplicationTimeout(finalDiagnostic);
    if (!isLifecycleReceiptCurrent(ports, transaction)) continue;
    if (!probe.value) {
      return { ready: false, reason: "gateway-unavailable" };
    }
    if (!ports.isAttestedConnectionCurrent(connectionId)) {
      return { ready: false, reason: "connection-unavailable" };
    }

    // Classic Wizard 的 done 是稳定协议给出的官方终态，不要求 Runtime 同时实现
    // Guided 方法。Guided 则使用当前方法族提供的 verify，或本次 activate 的
    // 真实模型调用结果；两种终态共享连接和 Runtime 身份门禁。
    if (evidence.kind === "guided") {
      const detection = await awaitWithinHandoffDeadline(() => evidence.detectSetup(), transaction);
      if (!detection.settled) return configurationApplicationTimeout(finalDiagnostic);
      if (!isLifecycleReceiptCurrent(ports, transaction)) continue;
      if (!ports.isAttestedConnectionCurrent(connectionId)) {
        return { ready: false, reason: "connection-unavailable" };
      }
      if (!detection.value.setupComplete) {
        return { ready: false, reason: "setup-incomplete" };
      }

      const modelEvidence = evidence.modelEvidence;
      if (modelEvidence.kind === "activation") {
        if (detection.value.configuredModel?.trim() !== modelEvidence.modelRef) {
          return {
            ready: false,
            reason: "model-unverified",
            diagnostic: "OpenClaw stable setup detection did not confirm the activated model.",
          };
        }
      } else {
        const verification = await awaitWithinHandoffDeadline(
          () => modelEvidence.verifyModel(),
          transaction,
        );
        if (!verification.settled) return configurationApplicationTimeout(finalDiagnostic);
        if (!isLifecycleReceiptCurrent(ports, transaction)) continue;
        if (!ports.isAttestedConnectionCurrent(connectionId)) {
          return { ready: false, reason: "connection-unavailable" };
        }
        if (!verification.value.ok) {
          return {
            ready: false,
            reason: "model-unverified",
            diagnostic: verification.value.error,
          };
        }
      }
    }

    const finalApplication = await verifyFinalConfigurationApplication(
      ports,
      connectionId,
      revisionHash,
      transaction,
    );
    if (!isLifecycleReceiptCurrent(ports, transaction)) continue;
    if (finalApplication.ready) return { ready: true };
    if (finalApplication.reason !== "configuration-application-timeout") {
      return finalApplication;
    }
    finalDiagnostic = finalApplication.diagnostic;
    pass += 1;
  }

  return {
    ready: false,
    reason: "configuration-application-timeout",
    ...(finalDiagnostic ? { diagnostic: finalDiagnostic } : {}),
  };
}

type ConfigurationConvergenceResult =
  | { ready: true; connectionId: string; revisionHash: string }
  | Extract<OpenClawSetupHandoffResult, { ready: false }>;

interface ConfigurationApplicationState {
  state: "applied" | "pending" | "unsupported";
  reloadDisabled?: boolean;
  revisionHash: string | null;
}

interface HandoffTransaction {
  deadline: number;
  now: () => number;
  explicitRestartAttempted: boolean;
  lifecycleReceipt: OpenClawSetupLifecycleReceipt | null;
  abortController: AbortController;
}

type HandoffDeadlineResult<T> =
  | { settled: true; value: T }
  | { settled: false };

const HANDOFF_TIMEOUT_MARKER = Symbol("openclaw-handoff-timeout");

function classifyConfigurationApplication(application: {
  configRevisionHash?: string;
  appliedConfigHash?: string | null;
  reloadDisabled?: boolean;
}): ConfigurationApplicationState {
  const revisionHash = application.configRevisionHash?.trim() ?? "";
  if (!revisionHash || application.appliedConfigHash === undefined) {
    return { state: "unsupported", reloadDisabled: false, revisionHash: null };
  }
  const appliedConfigHash = application.appliedConfigHash?.trim() ?? "";
  const state = Boolean(appliedConfigHash)
    && revisionHash === appliedConfigHash
    ? "applied"
    : "pending";
  return { state, reloadDisabled: application.reloadDisabled === true, revisionHash };
}

async function verifyFinalConfigurationApplication(
  ports: OpenClawSetupHandoffPorts,
  connectionId: string,
  expectedRevisionHash: string,
  transaction: HandoffTransaction,
): Promise<{ ready: true } | Extract<OpenClawSetupHandoffResult, { ready: false }>> {
  if (!ports.isAttestedConnectionCurrent(connectionId)) {
    return { ready: false, reason: "connection-unavailable" };
  }
  try {
    const read = await awaitWithinHandoffDeadline(
      () => ports.readConfigApplication(connectionId),
      transaction,
    );
    if (!read.settled) return configurationApplicationTimeout();
    if (!isLifecycleReceiptCurrent(ports, transaction)) {
      return configurationApplicationTimeout('Gateway lifecycle changed during configuration verification.');
    }
    const application = classifyConfigurationApplication(read.value);
    if (!ports.isAttestedConnectionCurrent(connectionId)) {
      return { ready: false, reason: "connection-unavailable" };
    }
    if (application.state === "unsupported") {
      return { ready: false, reason: "configuration-application-unavailable" };
    }
    return application.state === "applied" && application.revisionHash === expectedRevisionHash
      ? { ready: true }
      : configurationApplicationTimeout(
        application.state === "applied"
          ? "OpenClaw configuration revision changed during verification."
          : undefined,
      );
  } catch (error) {
    if (!ports.isAttestedConnectionCurrent(connectionId)) {
      return { ready: false, reason: "connection-unavailable" };
    }
    return {
      ready: false,
      reason: "configuration-application-timeout",
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
}

async function convergeConfigurationApplication(
  ports: OpenClawSetupHandoffPorts,
  transaction: HandoffTransaction,
): Promise<ConfigurationConvergenceResult> {
  const wait = ports.wait ?? ((delayMs) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  }));
  let observedConfigurationApplication = false;
  let lastConfigDiagnostic: string | undefined;
  const waitForApplication = async (): Promise<ConfigurationConvergenceResult | null> => {
    while (hasHandoffBudget(transaction)) {
      if (!isLifecycleReceiptCurrent(ports, transaction)) {
        if (!(await acquireLifecycleReceipt(ports, transaction))) return null;
        continue;
      }
      let connectionId = ports.captureAttestedConnectionId();
      if (!connectionId) {
        const reconnect = await awaitWithinHandoffDeadline(
          () => ports.reconnectSelectedRuntime(handoffBoundary(transaction)),
          transaction,
        );
        if (!reconnect.settled) return configurationApplicationTimeout(lastConfigDiagnostic);
        if (!reconnect.value.success) {
          return {
            ready: false,
            reason: "connection-unavailable",
            ...(reconnect.value.diagnostic ? { diagnostic: reconnect.value.diagnostic } : {}),
          };
        }
        if (!(await acquireLifecycleReceipt(ports, transaction))) return null;
        connectionId = reconnect.value.connectionId ?? ports.captureAttestedConnectionId();
      }
      if (!connectionId || !ports.isAttestedConnectionCurrent(connectionId)) {
        const waited = await awaitWithinHandoffDeadline(
          () => wait(Math.min(OPENCLAW_CONFIG_APPLICATION_POLL_MS, remainingHandoffBudget(transaction))),
          transaction,
        );
        if (!waited.settled) return null;
        continue;
      }
      const fencedConnectionId = connectionId;
      try {
        const read = await awaitWithinHandoffDeadline(
          () => ports.readConfigApplication(fencedConnectionId),
          transaction,
        );
        if (!read.settled) return null;
        if (!isLifecycleReceiptCurrent(ports, transaction)) continue;
        const application = classifyConfigurationApplication(read.value);
        observedConfigurationApplication = true;
        lastConfigDiagnostic = undefined;
        if (application.state === "unsupported") {
          return {
            ready: false,
            reason: "configuration-application-unavailable",
          };
        }
        if (application.state === "applied" && ports.isAttestedConnectionCurrent(connectionId)) {
          return { ready: true, connectionId, revisionHash: application.revisionHash! };
        }
        if (application.reloadDisabled && !transaction.explicitRestartAttempted) {
          transaction.explicitRestartAttempted = true;
          const restart = await awaitWithinHandoffDeadline(
            () => ports.restartSelectedRuntime(
              handoffBoundary(transaction),
              application.revisionHash!,
            ),
            transaction,
          );
          if (!restart.settled) return configurationApplicationTimeout(lastConfigDiagnostic);
          if (!restart.value.success) {
            return {
              ready: false,
              reason: "gateway-unavailable",
              ...(restart.value.diagnostic ? { diagnostic: restart.value.diagnostic } : {}),
            };
          }
          if (!(await acquireLifecycleReceipt(ports, transaction))) return null;
          connectionId = restart.value.connectionId ?? ports.captureAttestedConnectionId();
          if (!connectionId || !ports.isAttestedConnectionCurrent(connectionId)) {
            return { ready: false, reason: "connection-unavailable" };
          }
        }
      } catch (error) {
        lastConfigDiagnostic = error instanceof Error ? error.message : String(error);
        if (connectionId && ports.isAttestedConnectionCurrent(connectionId)) {
          const waited = await awaitWithinHandoffDeadline(
            () => wait(Math.min(OPENCLAW_CONFIG_APPLICATION_POLL_MS, remainingHandoffBudget(transaction))),
            transaction,
          );
          if (!waited.settled) return null;
          continue;
        }
        const reconnect = await awaitWithinHandoffDeadline(
          () => ports.reconnectSelectedRuntime(handoffBoundary(transaction)),
          transaction,
        );
        if (!reconnect.settled) return configurationApplicationTimeout(lastConfigDiagnostic);
        if (!reconnect.value.success) {
          return {
            ready: false,
            reason: "connection-unavailable",
            ...(reconnect.value.diagnostic ? { diagnostic: reconnect.value.diagnostic } : {}),
          };
        }
        if (!(await acquireLifecycleReceipt(ports, transaction))) return null;
      }
      const waited = await awaitWithinHandoffDeadline(
        () => wait(Math.min(OPENCLAW_CONFIG_APPLICATION_POLL_MS, remainingHandoffBudget(transaction))),
        transaction,
      );
      if (!waited.settled) return null;
    }
    return null;
  };

  const officialConvergence = await waitForApplication();
  if (officialConvergence) return officialConvergence;
  if (!observedConfigurationApplication && lastConfigDiagnostic) {
    return {
      ready: false,
      reason: "configuration-application-timeout",
      diagnostic: lastConfigDiagnostic,
    };
  }

  // OpenClaw 可能因活动工作将官方重启延后。普通等待超时不能证明重载已禁用，
  // 因而这里只保留待核验状态，不能主动终止进程或制造第二次重启。
  return {
    ready: false,
    reason: "configuration-application-timeout",
    ...(lastConfigDiagnostic ? { diagnostic: lastConfigDiagnostic } : {}),
  };
}

async function acquireLifecycleReceipt(
  ports: OpenClawSetupHandoffPorts,
  transaction: HandoffTransaction,
): Promise<boolean> {
  const lifecycleIdle = await awaitWithinHandoffDeadline(
    () => ports.waitForLifecycleIdle(handoffBoundary(transaction)),
    transaction,
  );
  if (!lifecycleIdle.settled || !lifecycleIdle.value) return false;
  const previousReceipt = transaction.lifecycleReceipt;
  if (
    lifecycleIdle.value.observedRestart
    || (
      previousReceipt
      && lifecycleIdle.value.restartAttemptGeneration > previousReceipt.restartAttemptGeneration
    )
  ) {
    transaction.explicitRestartAttempted = true;
  }
  transaction.lifecycleReceipt = lifecycleIdle.value;
  return ports.isLifecycleReceiptCurrent(lifecycleIdle.value);
}

function isLifecycleReceiptCurrent(
  ports: OpenClawSetupHandoffPorts,
  transaction: HandoffTransaction,
): boolean {
  return Boolean(
    transaction.lifecycleReceipt
    && ports.isLifecycleReceiptCurrent(transaction.lifecycleReceipt),
  );
}

function hasHandoffBudget(transaction: HandoffTransaction): boolean {
  return transaction.now() < transaction.deadline;
}

function remainingHandoffBudget(transaction: HandoffTransaction): number {
  return Math.max(1, transaction.deadline - transaction.now());
}

function handoffBoundary(transaction: HandoffTransaction): OpenClawSetupHandoffBoundary {
  return {
    deadline: transaction.deadline,
    signal: transaction.abortController.signal,
  };
}

function configurationApplicationTimeout(
  diagnostic?: string,
): Extract<OpenClawSetupHandoffResult, { ready: false }> {
  return {
    ready: false,
    reason: "configuration-application-timeout",
    ...(diagnostic ? { diagnostic } : {}),
  };
}

async function awaitWithinHandoffDeadline<T>(
  operation: () => Promise<T>,
  transaction: HandoffTransaction,
): Promise<HandoffDeadlineResult<T>> {
  if (!hasHandoffBudget(transaction)) {
    transaction.abortController.abort();
    return { settled: false };
  }
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeout = new Promise<typeof HANDOFF_TIMEOUT_MARKER>((resolve) => {
    timer = globalThis.setTimeout(() => {
      transaction.abortController.abort();
      resolve(HANDOFF_TIMEOUT_MARKER);
    }, remainingHandoffBudget(transaction));
  });
  try {
    // 先核对预算再创建 Promise，防止调用参数求值在截止时间后启动新副作用。
    const guardedOperation: Promise<T | typeof HANDOFF_TIMEOUT_MARKER> = Promise.resolve().then(async () => {
      if (!hasHandoffBudget(transaction) || transaction.abortController.signal.aborted) {
        transaction.abortController.abort();
        return HANDOFF_TIMEOUT_MARKER;
      }
      return await operation();
    });
    const result = await Promise.race([guardedOperation, timeout]);
    if (result === HANDOFF_TIMEOUT_MARKER || !hasHandoffBudget(transaction)) {
      transaction.abortController.abort();
      return { settled: false };
    }
    return { settled: true, value: result as T };
  } finally {
    if (timer) globalThis.clearTimeout(timer);
  }
}
