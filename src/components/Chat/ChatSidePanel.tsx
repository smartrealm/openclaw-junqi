import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import clsx from 'clsx';
import {
  CHAT_SIDE_PANEL_DEFAULT_WIDTH,
  CHAT_SIDE_PANEL_MIN_WIDTH,
  clampChatSidePanelWidth,
  maximumChatSidePanelWidth,
} from './chatSidePanelResize';

interface ChatSidePanelProps {
  title: string;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
  backLabel?: string;
  onBack?: () => void;
  headerActions?: ReactNode;
  overlay?: boolean;
  resizable?: boolean;
  resizeLabel?: string;
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
  resizable = false,
  resizeLabel,
  children,
}: ChatSidePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const resizeRef = useRef<{ pointerId: number; parentRight: number; maximum: number } | null>(null);
  const [panelWidth, setPanelWidth] = useState(CHAT_SIDE_PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);

  const availableWidth = () => panelRef.current?.parentElement?.getBoundingClientRect().width;
  const maximumWidth = () => maximumChatSidePanelWidth(availableWidth());
  const setClampedPanelWidth = (nextWidth: number, maximum = maximumWidth()) => {
    setPanelWidth(clampChatSidePanelWidth(nextWidth, maximum / 0.7));
  };
  const finishResize = (element: HTMLDivElement, pointerId: number) => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    resizeRef.current = null;
    setResizing(false);
  };

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
          : 'relative w-[var(--chat-side-panel-width,min(46%,720px))] min-w-[340px] max-w-[70%] shrink-0 border-l border-aegis-border max-md:absolute max-md:inset-0 max-md:z-40 max-md:w-full max-md:min-w-0',
      )}
      style={resizable && !overlay
        ? { '--chat-side-panel-width': `${panelWidth}px` } as CSSProperties
        : undefined}
      role="dialog"
      aria-modal={overlay || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
    >
      {resizable && !overlay && resizeLabel && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={resizeLabel}
          aria-valuemin={CHAT_SIDE_PANEL_MIN_WIDTH}
          aria-valuemax={maximumWidth()}
          aria-valuenow={clampChatSidePanelWidth(panelWidth, availableWidth())}
          tabIndex={0}
          title={resizeLabel}
          onDoubleClick={() => setClampedPanelWidth(CHAT_SIDE_PANEL_DEFAULT_WIDTH)}
          onKeyDown={(event) => {
            const maximum = maximumWidth();
            if (event.key === 'Home') {
              event.preventDefault();
              setClampedPanelWidth(CHAT_SIDE_PANEL_MIN_WIDTH, maximum);
              return;
            }
            if (event.key === 'End') {
              event.preventDefault();
              setClampedPanelWidth(maximum, maximum);
              return;
            }
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const step = event.shiftKey ? 48 : 16;
            setClampedPanelWidth(panelWidth + (event.key === 'ArrowLeft' ? step : -step), maximum);
          }}
          onPointerDown={(event) => {
            event.preventDefault();
            const parent = panelRef.current?.parentElement;
            if (!parent) return;
            const bounds = parent.getBoundingClientRect();
            const maximum = maximumChatSidePanelWidth(bounds.width);
            resizeRef.current = { pointerId: event.pointerId, parentRight: bounds.right, maximum };
            event.currentTarget.setPointerCapture(event.pointerId);
            setResizing(true);
          }}
          onPointerMove={(event) => {
            const state = resizeRef.current;
            if (!state || state.pointerId !== event.pointerId) return;
            setClampedPanelWidth(state.parentRight - event.clientX, state.maximum);
          }}
          onPointerUp={(event) => finishResize(event.currentTarget, event.pointerId)}
          onPointerCancel={(event) => finishResize(event.currentTarget, event.pointerId)}
          onLostPointerCapture={(event) => finishResize(event.currentTarget, event.pointerId)}
          className={clsx(
            'absolute inset-y-0 -left-1 z-20 block w-[7px] touch-none cursor-col-resize max-md:hidden focus-visible:outline-none focus-visible:bg-aegis-primary/35',
            resizing ? 'bg-aegis-primary/35' : 'bg-transparent hover:bg-aegis-primary/20',
          )}
        />
      )}
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
