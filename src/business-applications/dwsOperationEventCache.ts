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
