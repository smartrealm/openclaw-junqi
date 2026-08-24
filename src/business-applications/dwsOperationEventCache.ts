import type { DwsOperationFinished, DwsOperationOutput } from '@/api/tauri-commands';

export type DwsOperationEventCache = {
  readonly output: Record<string, string[]>;
  readonly events: Record<string, DwsOperationOutput[]>;
  readonly finished: Record<string, DwsOperationFinished>;
};

export function formatDwsOperationOutput(
  payload: DwsOperationOutput,
  diagnosticPrefix: string,
): string {
  return `${payload.stream === 'stderr' ? diagnosticPrefix : ''}${payload.line}`;
}

export function cacheDwsOperationOutput(
  cache: DwsOperationEventCache,
  payload: DwsOperationOutput,
  line: string,
): string[] {
  const output = [...(cache.output[payload.operationId] ?? []), line].slice(-400);
  const events = [...(cache.events[payload.operationId] ?? []), payload].slice(-400);
  cache.output[payload.operationId] = output;
  cache.events[payload.operationId] = events;
  return output;
}

export function cacheDwsOperationFinished(
  cache: DwsOperationEventCache,
  payload: DwsOperationFinished,
): void {
  cache.finished[payload.operationId] = payload;
}

export function releaseDwsOperationCache(
  cache: DwsOperationEventCache,
  operationId: string,
): void {
  delete cache.output[operationId];
  delete cache.events[operationId];
  delete cache.finished[operationId];
}

export function rememberFinalizedDwsOperation(
  operationIds: Set<string>,
  operationId: string,
  limit = 64,
): void {
  operationIds.add(operationId);
  while (operationIds.size > limit) {
    const oldest = operationIds.values().next().value as string | undefined;
    if (!oldest) break;
    operationIds.delete(oldest);
  }
}
