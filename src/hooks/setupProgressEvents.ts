export type SetupLogLevel = "info" | "success" | "warn" | "error";

export interface SetupProgressEvent {
  step: string | null;
  message: string;
  key: string | null;
  progress: number | null;
  error: string | null;
}

const SETUP_LOG_RULES: ReadonlyArray<{ level: SetupLogLevel; pattern: RegExp }> = [
  { level: "error", pattern: /\berr!|\b(error|failed|failure|fatal|timed out)\b|exited unexpectedly/ },
  { level: "warn", pattern: /\bnot (installed|ready|available)\b|\b(warn|warning|retry|retries|retrying|fallback|falling back)\b/ },
  { level: "success", pattern: /\bsuccess(ful|fully)?\b|\b(installed|complete|completed|ready|verified)\b/ },
];

export function normalizeSetupProgressPayload(payload: unknown): SetupProgressEvent | null {
  if (typeof payload === "string") {
    const message = payload.trim();
    return message ? { step: null, message, key: null, progress: null, error: null } : null;
  }
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.message !== "string" || !value.message.trim()) return null;
  const rawProgress = typeof value.progress === "number" && Number.isFinite(value.progress)
    ? value.progress
    : null;
  return {
    step: typeof value.step === "string" && value.step ? value.step : null,
    message: value.message.trim(),
    key: typeof value.key === "string" && value.key ? value.key : null,
    progress: rawProgress == null ? null : Math.max(0, Math.min(100, Math.round(rawProgress * 100))),
    error: typeof value.error === "string" && value.error ? value.error : null,
  };
}

export function classifySetupMessage(message: string, error?: string | null): SetupLogLevel {
  if (error) return "error";
  const normalized = message.toLowerCase();
  return SETUP_LOG_RULES.find((rule) => rule.pattern.test(normalized))?.level ?? "info";
}
