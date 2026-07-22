import type { RefObject } from 'react';
import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { debugError } from '@/utils/debugLog';
import { releaseTauriUnlisten, subscribeTauriListener } from '@/utils/tauriEvents';

export interface TerminalDropTargetBounds {
  targetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function buildTerminalDropTargetBounds(
  targetId: string,
  rect: RectLike,
  scaleFactor: number,
): TerminalDropTargetBounds | null {
  if (
    !targetId.trim()
    || !Number.isFinite(scaleFactor)
    || scaleFactor <= 0
    || !Number.isFinite(rect.left)
    || !Number.isFinite(rect.top)
    || !Number.isFinite(rect.width)
    || !Number.isFinite(rect.height)
    || rect.width <= 0
    || rect.height <= 0
  ) {
    return null;
  }

  return {
    targetId,
    // Tauri drag positions are physical pixels relative to the WebView. DOM
    // rects are CSS pixels relative to that same viewport.
    x: rect.left * scaleFactor,
    y: rect.top * scaleFactor,
    width: rect.width * scaleFactor,
    height: rect.height * scaleFactor,
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

/**
 * Keep a terminal panel's screen bounds in the native drop router. This is a
 * hook rather than a one-off DOM handler because OS file drops reach Rust
 * before the WebView can cancel a browser drag event.
 */
export function useTerminalDropTarget(
  targetId: string,
  elementRef: RefObject<HTMLElement>,
): void {
  useEffect(() => {
    if (!isTauriRuntime()) return;

    let disposed = false;
    let animationFrame: number | null = null;
    let revision = 0;
    let commandQueue: Promise<void> = Promise.resolve();
    const unlisteners: Array<() => void> = [];

    const enqueueNativeUpdate = (operation: () => Promise<unknown>) => {
      commandQueue = commandQueue
        .catch(() => undefined)
        .then(async () => {
          await operation();
        });
      return commandQueue;
    };

    const remove = () => {
      void enqueueNativeUpdate(() => invoke('remove_terminal_drop_target', { targetId }));
    };

    const sync = async () => {
      animationFrame = null;
      const currentRevision = ++revision;
      const element = elementRef.current;
      if (!element || !element.isConnected) {
        remove();
        return;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        remove();
        return;
      }

      try {
        const appWindow = getCurrentWindow();
        const scaleFactor = await appWindow.scaleFactor();
        if (disposed || currentRevision !== revision) return;
        const target = buildTerminalDropTargetBounds(targetId, rect, scaleFactor);
        if (!target) {
          remove();
          return;
        }
        await enqueueNativeUpdate(() => invoke('upsert_terminal_drop_target', { target }));
      } catch (error) {
        if (!disposed) debugError('terminal', '[terminal] unable to sync file-drop target:', error);
      }
    };

    const scheduleSync = () => {
      if (disposed || animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        void sync();
      });
    };

    const observer = new ResizeObserver(scheduleSync);
    const element = elementRef.current;
    if (element) observer.observe(element);
    window.addEventListener('resize', scheduleSync);

    try {
      const appWindow = getCurrentWindow();
      unlisteners.push(subscribeTauriListener(
        () => appWindow.onScaleChanged(scheduleSync),
        (error) => {
          if (!disposed) debugError('terminal', '[terminal] unable to observe window bounds:', error);
        },
      ));
    } catch (error) {
      if (!disposed) debugError('terminal', '[terminal] unable to access the current window:', error);
    }

    scheduleSync();

    return () => {
      disposed = true;
      revision += 1;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      unlisteners.forEach((unlisten) => releaseTauriUnlisten(unlisten));
      remove();
    };
  }, [elementRef, targetId]);
}
