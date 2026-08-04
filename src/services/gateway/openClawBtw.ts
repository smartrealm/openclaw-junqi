export interface OpenClawBtwSideResult {
  kind: 'btw';
  sessionKey: string;
  runId: string;
  question: string;
  text: string;
  isError: boolean;
  ts: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Matches the current OpenClaw Gateway `/btw` turn classifier for direct chat input. */
export function isOpenClawBtwRequestText(text: string): boolean {
  return /^\/btw(?::|\s|$)/i.test(text.trim());
}

/** Decode the ephemeral side-question event that OpenClaw does not add to chat history. */
export function parseOpenClawBtwSideResult(raw: unknown): OpenClawBtwSideResult | null {
  if (!isRecord(raw) || raw.kind !== 'btw') return null;
  const sessionKey = requiredString(raw.sessionKey);
  const runId = requiredString(raw.runId);
  const question = requiredString(raw.question);
  const text = requiredString(raw.text);
  const ts = timestamp(raw.ts);
  if (!sessionKey || !runId || !question || !text || typeof raw.isError !== 'boolean' || ts === null) {
    return null;
  }
  return {
    kind: 'btw',
    sessionKey,
    runId,
    question,
    text,
    isError: raw.isError,
    ts,
  };
}
