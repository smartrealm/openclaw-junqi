// Unified alert/confirm dialog — consistent with ScreenshotPicker.
// Replaces native alert()/confirm() across the app.

import { useEffect, useId, useRef } from 'react';
import { X, ShieldAlert, AlertTriangle, Info, CheckCircle, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import i18n from '@/i18n';
import { showAlert, showConfirm, useAlertStore, type AlertVariant } from './alertStore';

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
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => {
      (cancelRef.current || dismissRef.current || dialogRef.current)?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  const colors = VARIANT_COLORS[variant];
  const Icon = VARIANT_ICONS[variant];

  const handleBackdrop = (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); };

  return (
    <div className="fixed inset-0 z-[2147481000] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={handleBackdrop}>
      <div
        ref={dialogRef}
        role={confirmLabel ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? descriptionId : undefined}
        tabIndex={-1}
        className="w-[min(380px,calc(100vw-32px))] rounded-lg bg-aegis-menu-bg border border-aegis-menu-border shadow-2xl overflow-hidden animate-fade-in outline-none"
        style={{ boxShadow: '0 25px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05) inset' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center', colors.bg, colors.border)}>
              <Icon size={16} className={colors.icon} />
            </div>
            <h3 id={titleId} className="text-[14px] font-semibold text-aegis-text">{title}</h3>
          </div>
          <button onClick={onClose} aria-label={i18n.t('common.close') as string} className="w-7 h-7 rounded flex items-center justify-center hover:bg-[rgb(var(--aegis-overlay)/0.08)] focus-visible:ring-2 focus-visible:ring-aegis-primary/50 transition-colors">
            <X size={15} className="text-aegis-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 pb-5">
          {(message || children) && (
            <div className="mb-4 ps-[42px] pe-1">
              {message && <p id={descriptionId} className="text-[12px] text-aegis-text-muted leading-relaxed">{message}</p>}
              {children}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 justify-end">
            {confirmLabel && onConfirm && (
              <>
                <button ref={cancelRef} onClick={onClose} className="px-3.5 py-1.5 rounded text-[12px] font-medium text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] focus-visible:ring-2 focus-visible:ring-aegis-primary/50 transition-colors">
                  {cancelLabel || (i18n.t('common.cancel') as string)}
                </button>
                <button
                  onClick={() => { onConfirm(); onClose(); }}
                  className={clsx('px-3.5 py-1.5 rounded text-[12px] font-semibold border focus-visible:ring-2 focus-visible:ring-aegis-primary/50 transition-colors', colors.btn, colors.btnHover)}
                >
                  {confirmLabel}
                </button>
              </>
            )}
            {!confirmLabel && (
              <button
                ref={dismissRef}
                onClick={onClose}
                className={clsx('px-3.5 py-1.5 rounded text-[12px] font-semibold border focus-visible:ring-2 focus-visible:ring-aegis-primary/50 transition-colors', colors.btn, colors.btnHover)}
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

export { showAlert, showConfirm, useAlertStore };
export type { AlertVariant };
