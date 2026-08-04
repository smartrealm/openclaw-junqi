export const OPENCLAW_CHAT_SEND_TIMING_PHASES = [
  'dispatch-started',
  'model-selected',
  'agent-run-started',
  'first-assistant-event',
  'dispatch-completed',
  'post-dispatch-completed',
] as const;

export type OpenClawChatSendTimingPhase = (typeof OPENCLAW_CHAT_SEND_TIMING_PHASES)[number];

export interface OpenClawChatSendTiming {
  sessionKey: string;
  runId: string;
  phase: OpenClawChatSendTimingPhase;
  ackToPhaseMs: number;
  receivedToPhaseMs: number;
  dispatchStartedToPhaseMs?: number;
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function duration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function timingPhase(value: unknown): OpenClawChatSendTimingPhase | null {
  if (typeof value !== 'string') return null;
  return OPENCLAW_CHAT_SEND_TIMING_PHASES.find((phase) => phase === value) ?? null;
}

/** Decode the read-only timing event emitted by OpenClaw's Control UI transport. */
export function parseOpenClawChatSendTiming(raw: unknown): OpenClawChatSendTiming | null {
  if (!isRecord(raw)) return null;
  const sessionKey = requiredString(raw.sessionKey);
  const runId = requiredString(raw.runId);
  const phase = timingPhase(raw.phase);
  const ackToPhaseMs = duration(raw.ackToPhaseMs);
  const receivedToPhaseMs = duration(raw.receivedToPhaseMs);
  if (!sessionKey || !runId || !phase || ackToPhaseMs === null || receivedToPhaseMs === null) {
    return null;
  }

  const dispatchStartedToPhaseMs = raw.dispatchStartedToPhaseMs === undefined
    ? undefined
    : duration(raw.dispatchStartedToPhaseMs);
  if (dispatchStartedToPhaseMs === null) return null;

  return {
    sessionKey,
    runId,
    phase,
    ackToPhaseMs,
    receivedToPhaseMs,
    ...(typeof dispatchStartedToPhaseMs === 'number' ? { dispatchStartedToPhaseMs } : {}),
  };
}
