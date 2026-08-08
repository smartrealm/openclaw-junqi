export class DingTalkRuntimeError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DingTalkRuntimeError";
    this.code = code;
    if (details) this.details = details;
  }
}

export function serializeRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof DingTalkRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: "DWS_RUNTIME_FAILURE",
    message: error instanceof Error ? error.message : String(error),
  };
}
