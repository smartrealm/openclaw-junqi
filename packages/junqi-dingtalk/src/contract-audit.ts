import { serializeRuntimeError } from "./errors.js";
import type { DwsSchemaRegistry } from "./schema-contract.js";
import type { DingTalkToolSpec } from "./types.js";

export interface DingTalkContractAuditFailure {
  readonly toolName: string;
  readonly canonicalPath: string;
  readonly error: Record<string, unknown>;
}

export interface DingTalkContractAuditResult {
  readonly checkedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly failures: readonly DingTalkContractAuditFailure[];
}

export async function auditDingTalkContracts(
  schemas: DwsSchemaRegistry,
  specs: readonly DingTalkToolSpec[],
  concurrency = 4,
): Promise<DingTalkContractAuditResult> {
  const workerCount = Math.max(1, Math.min(concurrency, specs.length || 1));
  const failures: DingTalkContractAuditFailure[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < specs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const spec = specs[index];
      if (!spec) continue;
      try {
        await schemas.verify(spec);
      } catch (error) {
        failures.push({
          toolName: spec.name,
          canonicalPath: spec.canonicalPath,
          error: serializeRuntimeError(error),
        });
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, worker));
  failures.sort((left, right) => left.toolName.localeCompare(right.toolName));
  return {
    checkedCount: specs.length,
    passedCount: specs.length - failures.length,
    failedCount: failures.length,
    failures,
  };
}
