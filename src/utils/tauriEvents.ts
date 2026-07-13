import { emit, listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';

export function hasTauriEventBridge(): boolean {
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: { transformCallback?: unknown; invoke?: unknown };
  }).__TAURI_INTERNALS__;
  return typeof internals?.transformCallback === 'function'
    && typeof internals?.invoke === 'function';
}

/**
 * Tauri's listen() resolves asynchronously. If a React effect unmounts before the
 * promise resolves, a naive `.then(unlistens.push)` leaks the subscription.
 */
export function subscribeTauriEvent<T>(
  event: string,
  handler: EventCallback<T>,
  onError?: (error: unknown) => void,
): UnlistenFn {
  if (!hasTauriEventBridge()) return () => {};

  let disposed = false;
  let unlisten: UnlistenFn | null = null;

  listen<T>(event, handler)
    .then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    })
    .catch((error) => {
      if (!disposed) onError?.(error);
    });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

/** Emit across Tauri windows while remaining a safe no-op in browser previews. */
export async function emitTauriEvent<T>(event: string, payload?: T): Promise<void> {
  if (!hasTauriEventBridge()) return;
  await emit(event, payload);
}

export function combineUnlisteners(unlisteners: UnlistenFn[]): UnlistenFn {
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
