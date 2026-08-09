export const OPENCLAW_CHAT_RUN_STARTUP_PHASES = [
  'preparing_workspace',
  'provisioning_environment',
  'preparing_context',
  'starting_model',
] as const;

export type OpenClawChatRunStartupPhase = typeof OPENCLAW_CHAT_RUN_STARTUP_PHASES[number];

export interface OpenClawChatRunStartup {
  runId: string;
  phase: OpenClawChatRunStartupPhase;
}

export interface OpenClawChatDeltaProjectionInput {
  deltaText?: unknown;
  replace?: unknown;
  snapshotText: string | null;
}

export interface OpenClawChatSendDeliveryUncertain {
  deliveryUncertain: true;
  runId: string;
}

const CHAT_RUN_STARTUP_PHASE_SET = new Set<string>(OPENCLAW_CHAT_RUN_STARTUP_PHASES);

export function isOpenClawChatSendDeliveryUncertain(
  value: unknown,
): value is OpenClawChatSendDeliveryUncertain {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).deliveryUncertain === true
    && typeof (value as Record<string, unknown>).runId === 'string',
  );
}

export function parseOpenClawChatRunStartup(value: unknown): OpenClawChatRunStartup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.state !== 'status') return null;
  const runId = typeof record.runId === 'string' ? record.runId.trim() : '';
  const phase = typeof record.phase === 'string' ? record.phase : '';
  if (!runId || !CHAT_RUN_STARTUP_PHASE_SET.has(phase)) return null;
  return { runId, phase: phase as OpenClawChatRunStartupPhase };
}

export function resolveOpenClawChatDeltaText(
  currentStream: string | null,
  input: OpenClawChatDeltaProjectionInput,
): string | null {
  const deltaText = typeof input.deltaText === 'string' ? input.deltaText : null;
  if (deltaText !== null) {
    if (input.replace === true) return deltaText;
    if (currentStream === null) return input.snapshotText ?? deltaText;
    if (input.snapshotText !== null) {
      const prefixLength = input.snapshotText.length - deltaText.length;
      if (
        prefixLength !== currentStream.length
        || input.snapshotText.slice(0, prefixLength) !== currentStream
      ) {
        return input.snapshotText;
      }
    }
    return `${currentStream}${deltaText}`;
  }
  return input.snapshotText;
}
