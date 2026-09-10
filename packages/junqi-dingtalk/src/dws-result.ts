import { DingTalkRuntimeError } from "./errors.js";
import type { DwsCommandResult } from "./types.js";

export function requireDwsSuccessResult(result: DwsCommandResult): unknown {
  const envelope = result.data;
  if (
    !envelope
    || typeof envelope !== "object"
    || Array.isArray(envelope)
    || (envelope as Record<string, unknown>).ok !== true
    || (envelope as Record<string, unknown>).outcome !== "success"
    || !Object.hasOwn(envelope, "data")
  ) {
    throw new DingTalkRuntimeError(
      "DWS_RESULT_INVALID",
      "DWS command did not return a successful unified result envelope",
    );
  }
  return (envelope as Record<string, unknown>).data;
}
