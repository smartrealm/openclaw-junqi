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

const PUBLIC_ERROR_MESSAGES = {
  DWS_AGENT_CONFIGURATION_INVALID: "DWS agent authorization configuration is invalid",
  DWS_ARGUMENT_INVALID: "DWS arguments must be JSON values",
  DWS_ARGUMENT_REQUIRED: "DWS arguments are missing required fields",
  DWS_ARGUMENT_TYPE: "A DWS argument has an invalid type",
  DWS_ARGUMENT_UNKNOWN: "DWS arguments contain unsupported fields",
  DWS_ARGUMENTS_REQUIRED: "DWS arguments must be a JSON object",
  DWS_CANCELLED: "DWS execution was cancelled",
  DWS_COMMAND_FAILED: "DWS command failed",
  DWS_EMPTY_OUTPUT: "DWS returned no JSON output",
  DWS_INVALID_JSON: "DWS returned invalid JSON output",
  DWS_OUTPUT_LIMIT: "DWS output exceeded the configured limit",
  DWS_PATH_AMBIGUOUS: "Multiple DWS executables were found",
  DWS_PATH_NOT_ABSOLUTE: "Configured dwsPath must be an absolute path",
  DWS_PROFILE_INVALID: "DWS profile has an invalid format",
  DWS_PROFILE_REQUIRED: "DWS profile must be provided",
  DWS_RUNTIME_NOT_EXECUTABLE: "Configured DWS executable is unavailable",
  DWS_RUNTIME_NOT_FOUND: "DWS executable was not found",
  DWS_SCHEMA_DRIFT: "DWS schema differs from the reviewed contract",
  DWS_SCHEMA_INVALID: "DWS returned an invalid schema",
  DWS_SPAWN_FAILED: "Failed to start DWS",
  DWS_TIMEOUT: "DWS execution timed out",
} as const;

type PublicErrorCode = keyof typeof PUBLIC_ERROR_MESSAGES;

function isPublicErrorCode(value: string): value is PublicErrorCode {
  return Object.prototype.hasOwnProperty.call(PUBLIC_ERROR_MESSAGES, value);
}

function safeDetails(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const details: Record<string, unknown> = {};
  if (Array.isArray(value.fields)) {
    const fields = value.fields.filter((field): field is string => (
      typeof field === "string" && field.length > 0 && field.length <= 128
    ));
    if (fields.length > 0) details.fields = fields.slice(0, 64);
  }
  if (Number.isSafeInteger(value.matchCount) && Number(value.matchCount) >= 0) {
    details.matchCount = value.matchCount;
  }
  if (Number.isSafeInteger(value.exitCode)) details.exitCode = value.exitCode;
  if (typeof value.signal === "string" && /^[A-Z0-9]+$/.test(value.signal)) {
    details.signal = value.signal;
  }
  if (
    typeof value.recoveryEventId === "string"
    && /^[A-Za-z0-9._:-]{1,256}$/.test(value.recoveryEventId)
  ) {
    details.recoveryEventId = value.recoveryEventId;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

export function serializeRuntimeError(error: unknown): Record<string, unknown> {
  if (error instanceof DingTalkRuntimeError && isPublicErrorCode(error.code)) {
    const details = safeDetails(error.details);
    return {
      code: error.code,
      message: PUBLIC_ERROR_MESSAGES[error.code],
      ...(details ? { details } : {}),
    };
  }
  return {
    code: "DWS_RUNTIME_FAILURE",
    message: "DWS runtime operation failed",
  };
}
