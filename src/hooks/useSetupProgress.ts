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

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GatewayRecoveryStatus } from '@/services/gateway/recoveryProgress';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export interface SetupProgressDetail {
  step: string;
  message: string;
  progress: number;
  /** Optional i18n key. When present the `message` field falls back
   *  to the (typically English) raw text. */
  key?: string;
  /** Terminal recovery states keep controls usable after a failed attempt. */
  status?: GatewayRecoveryStatus;
}

export interface SetupProgressEventPayload extends SetupProgressDetail {
  /** Interpolation args merged into the t() call. */
  params?: Record<string, unknown>;
  /** Rust producers set this for terminal failures. Keep it as a compatibility
   * fallback for older producers that have not added an explicit status yet. */
  error?: string | null;
  /** Third-party command output belongs in diagnostics, not status surfaces. */
  diagnostic?: boolean;
}

export function useSetupProgress(filterStep?: string): SetupProgressDetail | null {
  const { t } = useTranslation();
  const [latest, setLatest] = useState<SetupProgressEventPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    function accept(d: Partial<SetupProgressEventPayload> | undefined): void {
      const message = d?.message;
      if (!d || typeof d.step !== 'string' || typeof message !== 'string') return;
      if (d.diagnostic === true) return;
      if (filterStep && d.step !== filterStep) return;
      const step = d.step;
      const progress = typeof d.progress === 'number' ? d.progress : 0;
      const key = typeof d.key === 'string' ? d.key : undefined;
      const explicitStatus = d.status === 'completed' || d.status === 'failed' || d.status === 'running'
        ? d.status
        : undefined;
      const status = explicitStatus ?? (typeof d.error === 'string' && d.error.trim() ? 'failed' : undefined);
      setLatest((previous) => {
        // A recovery may switch from ensure -> restart -> health check. Those
        // producers report their own local percentages, so retain the furthest
        // running value and never visually move a progress bar backwards.
        const previousRunning = previous?.status !== 'completed' && previous?.status !== 'failed';
        const nextRunning = status !== 'completed' && status !== 'failed';
        const resolvedProgress = previous && previous.step === step && previousRunning && nextRunning
          ? Math.max(previous.progress, progress)
          : progress;
        return {
          step,
          message,
          progress: resolvedProgress,
          key,
          status,
          params: d.params,
        };
      });
    }

    // Producer 1: Tauri event from Rust.
    const unlisten = subscribeTauriEvent<SetupProgressEventPayload>('setup-progress', (e) => {
      if (!cancelled) accept(e.payload);
    });

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
      unlisten();
    };
  }, [filterStep]);

  return useMemo(() => {
    if (!latest) return null;
    return localizeSetupProgressDetail(t, latest);
  }, [latest, t]);
}

export function localizeSetupProgressDetail(
  t: (key: string, params?: Record<string, unknown>) => string,
  detail: SetupProgressEventPayload,
): SetupProgressDetail {
  return {
    step: detail.step,
    message: resolveProgressMessage(t, detail),
    progress: detail.progress,
    key: detail.key,
    status: detail.status,
  };
}

/** Static helper: resolve a one-off event payload (used in setup-producers
 *  that aren't inside a React tree). Returns the raw message if no key. */
export function resolveProgressMessage(
  t: (key: string, params?: Record<string, unknown>) => string,
  detail: Partial<SetupProgressEventPayload>,
): string {
  if (typeof detail.key === 'string' && detail.message) {
    const out = t(detail.key, detail.params ?? {});
    return out === detail.key ? detail.message : out;
  }
  return detail.message ?? '';
}
