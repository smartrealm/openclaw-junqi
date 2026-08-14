import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import clsx from 'clsx';

interface ChatSidePanelProps {
  title: string;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
  backLabel?: string;
  onBack?: () => void;
  headerActions?: ReactNode;
  overlay?: boolean;
  children: ReactNode;
}

export function ChatSidePanel({
  title,
  titleId,
  closeLabel,
  onClose,
  backLabel,
  onBack,
  headerActions,
  overlay = false,
  children,
}: ChatSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!overlay) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose, overlay]);

  return (
    <aside
      ref={panelRef}
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden bg-aegis-bg text-aegis-text',
        overlay
          ? 'absolute inset-0 z-40'
          : 'relative w-[min(46%,720px)] min-w-[340px] shrink-0 border-l border-aegis-border max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full max-md:min-w-0',
      )}
      role="dialog"
      aria-modal={overlay || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-aegis-border px-4">
        {onBack && backLabel && (
          <button
            type="button"
            onClick={onBack}
            className="grid size-8 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
            title={backLabel}
            aria-label={backLabel}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-[13px] font-semibold">
          {title}
        </h2>
        {headerActions}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="grid size-8 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
          title={closeLabel}
          aria-label={closeLabel}
        >
          <X size={16} />
        </button>
      </header>
      {children}
    </aside>
  );
}
