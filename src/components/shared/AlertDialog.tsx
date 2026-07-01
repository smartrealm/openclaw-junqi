// Unified alert/confirm dialog — consistent with ScreenshotPicker.
// Replaces native alert()/confirm() across the app.

import { X, ShieldAlert, AlertTriangle, Info, CheckCircle, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import i18n from '@/i18n';

export type AlertVariant = 'info' | 'warning' | 'error' | 'success' | 'confirm';

interface AlertDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  children?: React.ReactNode;
  variant?: AlertVariant;
  /** Confirm mode: shows Cancel + Confirm buttons */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  /** Dismiss-only label */
  dismissLabel?: string;
}

const VARIANT_ICONS: Record<AlertVariant, any> = {
  info: Info,
  warning: AlertTriangle,
  error: ShieldAlert,
  success: CheckCircle,
  confirm: HelpCircle,
};

const VARIANT_COLORS: Record<AlertVariant, { border: string; bg: string; icon: string; accent: string; btn: string; btnHover: string }> = {
  info:    { border: 'border-blue-500/20', bg: 'bg-blue-500/5',   icon: 'text-blue-400',   accent: 'text-blue-300',   btn: 'bg-blue-500/15 text-blue-300 border-blue-500/20', btnHover: 'hover:bg-blue-500/25' },
  warning: { border: 'border-amber-500/20', bg: 'bg-amber-500/5',  icon: 'text-amber-400',  accent: 'text-amber-300',  btn: 'bg-amber-500/15 text-amber-300 border-amber-500/20', btnHover: 'hover:bg-amber-500/25' },
  error:   { border: 'border-red-500/20',  bg: 'bg-red-500/5',    icon: 'text-red-400',    accent: 'text-red-300',    btn: 'bg-red-500/15 text-red-300 border-red-500/20', btnHover: 'hover:bg-red-500/25' },
  success: { border: 'border-emerald-500/20', bg: 'bg-emerald-500/5', icon: 'text-emerald-400', accent: 'text-emerald-300', btn: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20', btnHover: 'hover:bg-emerald-500/25' },
  confirm: { border: 'border-aegis-primary/20', bg: 'bg-aegis-primary/5', icon: 'text-aegis-primary', accent: 'text-aegis-primary', btn: 'bg-aegis-primary/15 text-aegis-primary border-aegis-primary/20', btnHover: 'hover:bg-aegis-primary/25' },
};

export function AlertDialog({ open, onClose, title, message, children, variant = 'info', confirmLabel, cancelLabel, onConfirm, dismissLabel }: AlertDialogProps) {
  if (!open) return null;
  const colors = VARIANT_COLORS[variant];
  const Icon = VARIANT_ICONS[variant];

  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div className="fixed inset-0 z-[2147481000] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleBackdrop}>
      <div
        className="w-[380px] rounded-2xl bg-aegis-menu-bg border border-aegis-menu-border shadow-2xl overflow-hidden animate-fade-in"
        style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', colors.bg, colors.border)}>
              <Icon size={16} className={colors.icon} />
            </div>
            <h3 className="text-[14px] font-semibold text-aegis-text">{title}</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-[rgb(var(--aegis-overlay)/0.08)] transition-colors">
            <X size={15} className="text-aegis-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5">
          {(message || children) && (
            <div className={clsx('rounded-xl border p-4 mb-3', colors.border, colors.bg)}>
              <div className="flex items-start gap-3">
                <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5', colors.bg, colors.border)}>
                  <Icon size={15} className={colors.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  {message && <p className="text-[12px] text-aegis-text-muted leading-relaxed">{message}</p>}
                  {children}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            {confirmLabel && onConfirm && (
              <>
                <button onClick={onClose} className="px-3.5 py-1.5 rounded-lg text-[12px] font-medium text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] transition-colors">
                  {cancelLabel || (i18n.t('common.cancel') as string)}
                </button>
                <button
                  onClick={() => { onConfirm(); onClose(); }}
                  className={clsx('px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors', colors.btn, colors.btnHover)}
                >
                  {confirmLabel}
                </button>
              </>
            )}
            {!confirmLabel && (
              <button
                onClick={onClose}
                className={clsx('px-3.5 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors', colors.btn, colors.btnHover)}
              >
                {dismissLabel || (i18n.t('common.dismiss') as string)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Store-backed global dialog (singleton) ──
import { create } from 'zustand';

interface AlertState {
  open: boolean;
  title: string;
  message: string;
  variant: AlertVariant;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
}

export const useAlertStore = create<AlertState & {
  alert: (params: Omit<AlertState, 'open'>) => void;
  confirm: (params: Omit<AlertState, 'open' | 'variant'> & { variant?: AlertVariant }) => void;
  close: () => void;
}>(set => ({
  open: false,
  title: '',
  message: '',
  variant: 'info',
  alert: (params) => set({ ...params, open: true, confirmLabel: undefined, onConfirm: undefined }),
  confirm: (params) => set({ ...params, open: true }),
  close: () => set({ open: false }),
}));

/** Global alert dialog rendered once at the app root. Use `useAlertStore` to show. */
export function GlobalAlertDialog() {
  const { open, title, message, variant, confirmLabel, cancelLabel, onConfirm, close } = useAlertStore();
  return (
    <AlertDialog
      open={open}
      onClose={close}
      title={title}
      message={message}
      variant={variant}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      onConfirm={onConfirm}
    />
  );
}

// Quick helpers
export function showAlert(title: string, message: string, variant: AlertVariant = 'info') {
  useAlertStore.getState().alert({ title, message, variant });
}
export function showConfirm(title: string, message: string, onConfirm: () => void) {
  useAlertStore.getState().confirm({ title, message, variant: 'confirm', confirmLabel: (i18n.t('common.confirm') as string), onConfirm });
}
