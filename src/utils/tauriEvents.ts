import { emit, listen, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event';

export function hasTauriEventBridge(): boolean {
  const internals = (window as Window & {
    __TAURI_INTERNALS__?: { transformCallback?: unknown; invoke?: unknown };
  }).__TAURI_INTERNALS__;
  return typeof internals?.transformCallback === 'function'
    && typeof internals?.invoke === 'function';
}

/**
 * Tauri currently types `UnlistenFn` as synchronous, while the implementation
 * performs an asynchronous IPC round trip. Window teardown can invalidate the
 * native listener first, so cleanup must be both one-shot and rejection-safe.
 */
function releaseTauriListener(unlisten: UnlistenFn): void {
  try {
    const completion = unlisten() as unknown;
    if (completion && typeof (completion as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(completion).catch(() => undefined);
    }
  } catch {
    // Teardown is best effort. A destroyed WebView may already own the listener.
  }
}

/** Compatibility export for consumers that own window-scoped listeners. */
export function releaseTauriUnlisten(unlisten: UnlistenFn | null | undefined): void {
  if (unlisten) releaseTauriListener(unlisten);
}

type TauriEventSubscription = {
  release: UnlistenFn;
  ready: Promise<void>;
};

/** Own any Tauri listener registration, including window-scoped listeners. */
export function subscribeTauriListener(
  register: () => Promise<UnlistenFn>,
  onError?: (error: unknown) => void,
): UnlistenFn {
  let released = false;
  let unlisten: UnlistenFn | null = null;
  const release = () => {
    if (released) return;
    released = true;
    const active = unlisten;
    unlisten = null;
    if (active) releaseTauriListener(active);
  };

  let ready: Promise<UnlistenFn>;
  try {
    ready = register();
  } catch (error) {
    onError?.(error);
    return release;
  }
  void ready.then((fn) => {
    if (released) releaseTauriListener(fn);
    else unlisten = fn;
  }).catch((error) => {
    if (!released) onError?.(error);
  });
  return release;
}

function createTauriEventSubscription<T>(
  event: string,
  handler: EventCallback<T>,
  onError?: (error: unknown) => void,
): TauriEventSubscription {
  let released = false;
  let unlisten: UnlistenFn | null = null;

  const release = () => {
    if (released) return;
    released = true;
    const activeUnlisten = unlisten;
    unlisten = null;
    if (activeUnlisten) releaseTauriListener(activeUnlisten);
  };

  const safeHandler: EventCallback<T> = (payload) => {
    try {
      const result = (handler as (...args: Parameters<EventCallback<T>>) => unknown)(payload);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error) => onError?.(error));
      }
    } catch (error) {
      onError?.(error);
    }
  };
  const ready = listen<T>(event, safeHandler)
    .then((fn) => {
      if (released) {
        releaseTauriListener(fn);
        return;
      }
      unlisten = fn;
    })
    .catch((error) => {
      if (!released) onError?.(error);
      throw error;
    });

  return { release, ready };
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
  const subscription = createTauriEventSubscription(event, handler, onError);
  void subscription.ready.catch(() => undefined);
  return subscription.release;
}

/**
 * As above, but resolves only after the native subscription exists. Use this
 * when a producer must not start until its event consumers are listening.
 */
export function subscribeTauriEventReady<T>(
  event: string,
  handler: EventCallback<T>,
  onError?: (error: unknown) => void,
): Promise<UnlistenFn> {
  if (!hasTauriEventBridge()) return Promise.resolve(() => {});
  const subscription = createTauriEventSubscription(event, handler, onError);
  return subscription.ready.then(() => subscription.release);
}

/** Emit across Tauri windows while remaining a safe no-op in browser previews. */
export async function emitTauriEvent<T>(event: string, payload?: T): Promise<void> {
  if (!hasTauriEventBridge()) return;
  await emit(event, payload);
}

export function combineUnlisteners(unlisteners: UnlistenFn[]): UnlistenFn {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const unlisten of unlisteners) releaseTauriListener(unlisten);
  };
}
