import { requireDwsSuccessResult } from "./dws-result.js";
import { DingTalkRuntimeError } from "./errors.js";
import type { DingTalkToolSpec, DwsCommandResult } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertDingTalkReadResult(
  spec: DingTalkToolSpec,
  result: DwsCommandResult,
  argumentsValue?: unknown,
): unknown {
  if (spec.effect !== "read") return undefined;
  const data = requireDwsSuccessResult(result);
  if (spec.name !== "junqi_dingtalk_minutes_transcript") return data;
  const argumentsRecord = isRecord(argumentsValue) ? argumentsValue : null;
  const transcript = isRecord(data) ? data : null;
  const paragraphList = transcript?.paragraphList;
  if (
    !argumentsRecord
    || typeof argumentsRecord.id !== "string"
    || !transcript
    || transcript.taskUuid !== argumentsRecord.id
    || transcript.complete !== true
    || (transcript.direction !== "0" && transcript.direction !== "1")
    || !Number.isSafeInteger(transcript.pages)
    || (transcript.pages as number) < 1
    || !Number.isSafeInteger(transcript.paragraphCount)
    || (transcript.paragraphCount as number) < 0
    || !Number.isSafeInteger(transcript.duplicateCount)
    || (transcript.duplicateCount as number) < 0
    || !Array.isArray(paragraphList)
    || paragraphList.length !== transcript.paragraphCount
    || paragraphList.some((paragraph) => !isRecord(paragraph))
  ) {
    throw new DingTalkRuntimeError(
      "DWS_RESULT_INVALID",
      "DWS Minutes transcript did not prove complete same-task content",
    );
  }
  return transcript;
}
