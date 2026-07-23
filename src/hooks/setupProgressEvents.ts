export type SetupLogLevel = "info" | "success" | "warn" | "error";

export interface SetupProgressEvent {
  step: string | null;
  message: string;
  key: string | null;
  params: Record<string, string>;
  logSlot: string | null;
  progress: number | null;
  diagnostic: boolean;
  error: string | null;
  status: 'running' | 'completed' | 'failed' | null;
}

const SETUP_LOG_RULES: ReadonlyArray<{ level: SetupLogLevel; pattern: RegExp }> = [
  { level: "error", pattern: /\berr!|\b(error|failed|failure|fatal|timed out)\b|exited unexpectedly/ },
  { level: "warn", pattern: /\bnot (installed|ready|available)\b|\b(warn|warning|retry|retries|retrying|fallback|falling back)\b/ },
  { level: "success", pattern: /\bsuccess(ful|fully)?\b|\b(installed|complete|completed|ready|verified)\b/ },
];

export function normalizeSetupProgressPayload(payload: unknown): SetupProgressEvent | null {
  if (typeof payload === "string") {
    const message = payload.trim();
    return message ? {
      step: null,
      message,
      key: null,
      params: {},
      logSlot: null,
      progress: null,
      diagnostic: false,
      error: null,
      status: null,
    } : null;
  }
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.message !== "string" || !value.message.trim()) return null;
  const rawProgress = typeof value.progress === "number" && Number.isFinite(value.progress)
    ? value.progress
    : null;
  const params = value.params && typeof value.params === "object" && !Array.isArray(value.params)
    ? Object.fromEntries(
      Object.entries(value.params as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    )
    : {};
  return {
    step: typeof value.step === "string" && value.step ? value.step : null,
    message: value.message.trim(),
    key: typeof value.key === "string" && value.key ? value.key : null,
    params,
    logSlot: typeof value.logSlot === "string" && value.logSlot ? value.logSlot : null,
    progress: rawProgress == null ? null : Math.max(0, Math.min(100, Math.round(rawProgress * 100))),
    diagnostic: value.diagnostic === true,
    error: typeof value.error === "string" && value.error ? value.error : null,
    status: value.status === 'running' || value.status === 'completed' || value.status === 'failed'
      ? value.status
      : null,
  };
}

export function classifySetupMessage(message: string, error?: string | null): SetupLogLevel {
  if (error) return "error";
  const normalized = message.toLowerCase();
  return SETUP_LOG_RULES.find((rule) => rule.pattern.test(normalized))?.level ?? "info";
}
