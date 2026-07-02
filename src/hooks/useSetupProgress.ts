// ═══════════════════════════════════════════════════════════
// useSetupProgress — single source of truth for streaming
// install / connect progress messages.
//
// Two producers feed one event shape { step, message, progress }:
//   1. Rust → `setup-progress` (Tauri event)            — install flow
//   2. App.tsx → `aegis:gateway-progress` (window evt) — manual reconnect
//
// Components that need to display inline progress text
// (StatusBar, SetupPage) use this hook instead of wiring
// their own listeners. Calling it more than once is fine
// — each subscription is independent. Auto-clears when
// `clearWhenStep` matches and progress == 1.0 (optional).
// ═══════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SetupProgressDetail {
  step: string;
  message: string;
  progress: number;
}

export function useSetupProgress(filterStep?: string): SetupProgressDetail | null {
  const [latest, setLatest] = useState<SetupProgressDetail | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    function accept(d: Partial<SetupProgressDetail> | undefined): void {
      if (!d || typeof d.step !== 'string' || typeof d.message !== 'string') return;
      if (filterStep && d.step !== filterStep) return;
      const progress = typeof d.progress === 'number' ? d.progress : 0;
      setLatest({ step: d.step, message: d.message, progress });
    }

    // Producer 1: Tauri event from Rust.
    listen<SetupProgressDetail>('setup-progress', (e) => {
      if (!cancelled) accept(e.payload);
    }).then((fn) => {
      if (cancelled) fn(); else unlisten = fn;
    }).catch(() => { /* not running under Tauri — fine */ });

    // Producer 2: synthetic window event for non-install flows
    // (manual reconnect, boot recovery) that App.tsx raises.
    function onLocal(e: Event) {
      if (cancelled) return;
      accept((e as CustomEvent).detail);
    }
    window.addEventListener('aegis:gateway-progress', onLocal);

    return () => {
      cancelled = true;
      window.removeEventListener('aegis:gateway-progress', onLocal);
      unlisten?.();
    };
  }, [filterStep]);

  return latest;
}
