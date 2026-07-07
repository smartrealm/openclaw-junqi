import { listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';

/**
 * Tauri's listen() resolves asynchronously. If a React effect unmounts before the
 * promise resolves, a naive `.then(unlistens.push)` leaks the subscription.
 */
export function subscribeTauriEvent<T>(
  event: string,
  handler: EventCallback<T>,
  onError?: (error: unknown) => void,
): UnlistenFn {
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

export function combineUnlisteners(unlisteners: UnlistenFn[]): UnlistenFn {
  return () => {
    for (const unlisten of unlisteners) unlisten();
  };
}
