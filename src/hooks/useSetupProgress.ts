// ═══════════════════════════════════════════════════════════
// useSetupProgress — single source of truth for streaming
// install / connect progress messages, with i18n resolution.
//
// Two producers feed one event shape { step, message, progress, key? }:
//   1. Rust → `setup-progress` (Tauri event)            — install flow
//   2. App.tsx → `aegis:gateway-progress` (window evt) — manual reconnect
//
// When a `key` is present we look it up via react-i18next and prefer
// it over the English `message` fallback. This way Rust can emit
// locale-neutral English source-of-truth strings, App.tsx can emit
// `key` for hand-rolled flows, and all three UI surfaces (SetupPage,
// StatusBar) display the same localized copy.
//
// Calling the hook more than once is fine — each subscription is
// independent.
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface SetupProgressDetail {
  step: string;
  message: string;
  progress: number;
  /** Optional i18n key. When present the `message` field falls back
   *  to the (typically English) raw text. */
  key?: string;
}

interface RawSetupProgressDetail extends SetupProgressDetail {
  /** Interpolation args merged into the t() call. */
  params?: Record<string, unknown>;
}

export function useSetupProgress(filterStep?: string): SetupProgressDetail | null {
  const { t } = useTranslation();
  const initialTRef = useRef(t);
  const [latest, setLatest] = useState<SetupProgressDetail | null>(null);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    function accept(d: Partial<RawSetupProgressDetail> | undefined): void {
      if (!d || typeof d.step !== 'string' || typeof d.message !== 'string') return;
      if (filterStep && d.step !== filterStep) return;
      const progress = typeof d.progress === 'number' ? d.progress : 0;
      const key = typeof d.key === 'string' ? d.key : undefined;
      const display = key ? initialTRef.current(key, d.params ?? {}) : d.message;
      // If t() returned the key unchanged (no translation registered),
      // gracefully fall back to the raw message string.
      const message = display === key ? d.message : display;
      setLatest({ step: d.step, message, progress, key });
    }

    // Producer 1: Tauri event from Rust.
    listen<RawSetupProgressDetail>('setup-progress', (e) => {
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

/** Static helper: resolve a one-off event payload (used in setup-producers
 *  that aren't inside a React tree). Returns the raw message if no key. */
export function resolveProgressMessage(
  t: (key: string, params?: Record<string, unknown>) => string,
  detail: Partial<RawSetupProgressDetail>,
): string {
  if (typeof detail.key === 'string' && detail.message) {
    const out = t(detail.key, detail.params ?? {});
    return out === detail.key ? detail.message : out;
  }
  return detail.message ?? '';
}
