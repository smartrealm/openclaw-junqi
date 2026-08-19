import type { DwsOperationFinished, DwsOperationOutput } from '@/api/tauri-commands';

export type DwsOperationEventCache = {
  readonly output: Record<string, string[]>;
  readonly finished: Record<string, DwsOperationFinished>;
};

export function cacheDwsOperationOutput(
  cache: DwsOperationEventCache,
  payload: DwsOperationOutput,
  line: string,
): string[] {
  const output = [...(cache.output[payload.operationId] ?? []), line].slice(-400);
  cache.output[payload.operationId] = output;
  return output;
}

export function cacheDwsOperationFinished(
  cache: DwsOperationEventCache,
  payload: DwsOperationFinished,
): void {
  cache.finished[payload.operationId] = payload;
}
