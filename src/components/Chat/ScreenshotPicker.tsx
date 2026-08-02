// Screenshot Picker — native macOS screencapture integration.
// Clean card UI with primary interactive capture + fallback options.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Monitor, AppWindow, Camera, Crosshair, ShieldAlert, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import clsx from 'clsx';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { screenshotRuntime, type ScreenshotWindowSource } from '@/services/chat/screenshotRuntime';

interface ScreenshotPickerProps { open: boolean; onClose: () => void; onCapture: (dataUrl: string) => void; }

export function ScreenshotPicker({ open, onClose, onCapture }: ScreenshotPickerProps) {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const [windows, setWindows] = useState<ScreenshotWindowSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const operationGeneration = useRef(0);

  useEffect(() => {
    if (!open) {
      operationGeneration.current += 1;
      return;
    }
    const generation = ++operationGeneration.current;
    setPermissionDenied(false);
    setLoading(true);
    void tryInteractive(generation);
    void loadWindows(generation);
    return () => {
      if (operationGeneration.current === generation) operationGeneration.current += 1;
    };
  }, [open]);

  const [interacting, setInteracting] = useState(false);

  const tryInteractive = async (generation = ++operationGeneration.current) => {
    setInteracting(true);
    const result = await screenshotRuntime.captureInteractive();
    if (operationGeneration.current !== generation) return;
    setInteracting(false);
    if (result?.success && result.data) { onCapture(result.data); onClose(); return; }
    if ((result as any)?.tccDenied) setPermissionDenied(true);
  };

  const loadWindows = async (generation: number) => {
    try {
      const sources = await screenshotRuntime.listWindows();
      if (operationGeneration.current !== generation) return;
      setWindows(sources);
    } catch {} finally {
      if (operationGeneration.current === generation) setLoading(false);
    }
  };

  const captureScreen = async () => {
    const generation = ++operationGeneration.current;
    setCapturing('screen');
    try {
      const r = await screenshotRuntime.captureFullscreen();
      if (operationGeneration.current !== generation) return;
      if (r?.success && r.data) { onCapture(r.data); onClose(); return; }
      if (r?.tccDenied) setPermissionDenied(true);
    } catch {} finally {
      if (operationGeneration.current === generation) setCapturing(null);
    }
  };

  const captureWindow = async (id: string) => {
    const generation = ++operationGeneration.current;
    setCapturing(id);
    try {
      const r = await screenshotRuntime.captureWindow(id);
      if (operationGeneration.current !== generation) return;
      if (r.success && r.data) { onCapture(r.data); onClose(); }
    } catch {} finally {
      if (operationGeneration.current === generation) setCapturing(null);
    }
  };

  if (!open) return null;

  const picker = (
    <div className={clsx(
      'fixed inset-0 z-50 flex items-end justify-center pb-6',
      interacting ? 'bg-transparent' : 'bg-black/30'
    )} onClick={interacting ? undefined : onClose} role="dialog" aria-modal="true">
      <div
        className="w-[420px] max-h-[70vh] rounded-2xl bg-aegis-menu-bg border border-aegis-menu-border shadow-2xl overflow-hidden animate-fade-in"
        style={{ boxShadow: '0 -8px 40px rgba(0,0,0,0.4)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-aegis-primary/10 flex items-center justify-center">
              <Camera size={16} className="text-aegis-primary" />
            </div>
            <h3 className="text-[14px] font-semibold text-aegis-text">{t('screenshot.title')}</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[rgb(var(--aegis-overlay)/0.08)] transition-colors">
            <X size={15} className="text-aegis-text-muted" />
          </button>
        </div>

        <div className="px-5 pb-5" dir={dir}>
          {/* ── Permission denied ── */}
          {permissionDenied ? (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 mb-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldAlert size={15} className="text-amber-400" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-amber-300 mb-1.5">{t('screenshot.permissionRequired')}</div>
                  <p className="text-[11px] text-aegis-text-muted leading-relaxed mb-3">
                    {t('screenshot.permissionHint')}
                  </p>
                  <button
                    onClick={() => { onClose(); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors border border-amber-500/20"
                  >
                    {t('common.dismiss')}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ── Primary: Interactive capture ── */}
              <button
                onClick={() => void tryInteractive()}
                className={clsx(
                  'w-full flex items-center gap-3 p-3.5 rounded-xl border transition-all mb-3',
                  'border-aegis-primary/25 bg-gradient-to-br from-aegis-primary/8 to-aegis-primary/3 hover:from-aegis-primary/12 hover:to-aegis-primary/5',
                  'hover:border-aegis-primary/40 group'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-aegis-primary/15 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Crosshair size={20} className="text-aegis-primary" />
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <div className="text-[13px] font-semibold text-aegis-text">
                    {t('screenshot.interactive')}
                  </div>
                  <div className="text-[11px] text-aegis-text-dim mt-0.5">
                    {t('screenshot.interactiveDesc')}
                  </div>
                </div>
                <ChevronRight size={14} className="text-aegis-text-dim shrink-0 group-hover:translate-x-0.5 transition-transform" />
              </button>

              {/* ── Secondary: Full screen ── */}
              <button
                onClick={captureScreen}
                disabled={!!capturing}
                className={clsx(
                  'w-full flex items-center gap-3 p-3 rounded-xl border transition-all mb-3',
                  'border-aegis-border/50 hover:border-aegis-primary/20 hover:bg-[rgb(var(--aegis-overlay)/0.03)]',
                  capturing === 'screen' && 'opacity-50'
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-[rgb(var(--aegis-overlay)/0.04)] flex items-center justify-center shrink-0">
                  {capturing === 'screen' ? <LoadingIndicator size={18} className="text-aegis-primary" /> : <Monitor size={18} className="text-aegis-text-muted" />}
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <div className="text-[13px] font-medium text-aegis-text">{t('screenshot.fullScreen')}</div>
                  <div className="text-[11px] text-aegis-text-dim mt-0.5">{t('screenshot.fullScreenDesc')}</div>
                </div>
                {capturing === 'screen' && <span className="text-[10px] text-aegis-text-dim shrink-0">{t('screenshot.capturing')}</span>}
              </button>
            </>
          )}

          {/* ── Windows list ── */}
          {!permissionDenied && (
            <>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-[11px] text-aegis-text-dim">
                  <LoadingIndicator size={12} /> {t('screenshot.loading')}
                </div>
              ) : windows.length > 2 ? (
                <div className="mt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-aegis-text-dim mb-2 ml-0.5">{t('screenshot.windows')}</div>
                  <div className="grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto scrollbar-hidden">
                    {windows.map(w => (
                      <button
                        key={w.id} onClick={() => captureWindow(w.id)} disabled={!!capturing}
                        className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-aegis-border/30 hover:border-aegis-primary/20 hover:bg-aegis-primary/3 transition-all text-start disabled:opacity-40"
                      >
                        <AppWindow size={12} className="text-aegis-text-dim shrink-0" />
                        <span className="text-[11px] text-aegis-text-muted truncate">{w.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? picker : createPortal(picker, document.body);
}
