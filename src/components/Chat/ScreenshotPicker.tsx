// Screenshot Picker — native macOS screencapture integration.
// Clean card UI with primary interactive capture + fallback options.

import { useState, useEffect } from 'react';
import { X, Monitor, AppWindow, Loader2, Camera, Crosshair, ShieldAlert, ChevronRight, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { getDirection } from '@/i18n';
import clsx from 'clsx';

interface WindowSource { id: string; name: string; thumbnail: string; }

interface ScreenshotPickerProps { open: boolean; onClose: () => void; onCapture: (dataUrl: string) => void; }

export function ScreenshotPicker({ open, onClose, onCapture }: ScreenshotPickerProps) {
  const { t } = useTranslation();
  const { language } = useSettingsStore();
  const dir = getDirection(language);
  const [windows, setWindows] = useState<WindowSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPermissionDenied(false);
    setLoading(true);
    tryInteractive();
    loadWindows();
  }, [open]);

  const [interacting, setInteracting] = useState(false);

  const tryInteractive = async () => {
    const api = (window.aegis?.screenshot as any)?.captureInteractive as
      | (() => Promise<{ success: boolean; data?: string; cancelled?: boolean; tccDenied?: boolean }>)
      | undefined;
    if (!api) return;
    setInteracting(true);
    const result = await api();
    setInteracting(false);
    if (result?.success && result.data) { onCapture(result.data); onClose(); return; }
    if ((result as any)?.tccDenied) setPermissionDenied(true);
  };

  const loadWindows = async () => {
    try {
      const sources = await (window.aegis?.screenshot as any)?.getSources?.()
        || await window.aegis?.screenshot.getWindows() || null;
      if (Array.isArray(sources)) setWindows(sources.filter((w: WindowSource) => w.name));
    } catch {} finally { setLoading(false); }
  };

  const captureScreen = async () => {
    setCapturing('screen');
    try {
      const r: any = await window.aegis?.screenshot.capture?.();
      if (r?.success && r.data) { onCapture(r.data); onClose(); return; }
      if (r?.tccDenied) setPermissionDenied(true);
    } catch {} finally { setCapturing(null); }
  };

  const captureWindow = async (id: string) => {
    setCapturing(id);
    try {
      const r: any = await window.aegis?.screenshot.captureWindow(id);
      if (r?.success && r.data) { onCapture(r.data); onClose(); }
    } catch {} finally { setCapturing(null); }
  };

  if (!open) return null;

  return (
    <div className={clsx(
      'fixed inset-0 z-50 flex items-end justify-center pb-6',
      interacting ? 'bg-transparent' : 'bg-black/30'
    )} onClick={interacting ? undefined : onClose}>
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
            <h3 className="text-[14px] font-semibold text-aegis-text">{t('screenshot.title', '截图')}</h3>
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
                  <div className="text-[13px] font-semibold text-amber-300 mb-1.5">需要屏幕录制权限</div>
                  <p className="text-[11px] text-aegis-text-muted leading-relaxed mb-3">
                    打开 <b>系统设置 → 隐私与安全性 → 屏幕录制</b>，<br />
                    启用 <b>JunQi Desktop</b> 后重新截图。
                  </p>
                  <button
                    onClick={() => { onClose(); }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors border border-amber-500/20"
                  >
                    知道了
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* ── Primary: Interactive capture ── */}
              <button
                onClick={tryInteractive}
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
                    {t('screenshot.interactive', '选区截图')}
                  </div>
                  <div className="text-[11px] text-aegis-text-dim mt-0.5">
                    {t('screenshot.interactiveDesc', '拖拽选区 · 空格键切换窗口模式')}
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
                  {capturing === 'screen' ? <Loader2 size={18} className="animate-spin text-aegis-primary" /> : <Monitor size={18} className="text-aegis-text-muted" />}
                </div>
                <div className="flex-1 min-w-0 text-start">
                  <div className="text-[13px] font-medium text-aegis-text">{t('screenshot.fullScreen', '全屏截图')}</div>
                  <div className="text-[11px] text-aegis-text-dim mt-0.5">{t('screenshot.fullScreenDesc', '捕获所有显示器内容')}</div>
                </div>
                {capturing === 'screen' && <span className="text-[10px] text-aegis-text-dim shrink-0">截图中…</span>}
              </button>
            </>
          )}

          {/* ── Windows list ── */}
          {!permissionDenied && (
            <>
              {loading ? (
                <div className="flex items-center gap-2 py-3 text-[11px] text-aegis-text-dim">
                  <Loader2 size={12} className="animate-spin" /> 加载窗口列表…
                </div>
              ) : windows.length > 2 ? (
                <div className="mt-1">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-aegis-text-dim mb-2 ml-0.5">窗口</div>
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
}
