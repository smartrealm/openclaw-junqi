import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Check, FolderPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

interface RectLike {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface SizeLike {
  readonly width: number;
  readonly height: number;
}

export interface SessionGroupSubmenuPlacement {
  readonly side: 'left' | 'right';
  readonly top: number;
}

const VIEWPORT_GUTTER_PX = 8;
const MENU_GAP_PX = 4;

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

export function resolveSessionGroupSubmenuPlacement(
  parent: RectLike,
  trigger: RectLike,
  submenu: SizeLike,
  viewport: SizeLike,
): SessionGroupSubmenuPlacement {
  const fitsRight = parent.right + MENU_GAP_PX + submenu.width <= viewport.width - VIEWPORT_GUTTER_PX;
  const top = clamp(
    trigger.top - parent.top,
    VIEWPORT_GUTTER_PX - parent.top,
    viewport.height - VIEWPORT_GUTTER_PX - parent.top - submenu.height,
  );
  return { side: fitsRight ? 'right' : 'left', top };
}

export interface SessionGroupSubmenuProps {
  readonly open: boolean;
  readonly parentMenuRef: RefObject<HTMLElement | null>;
  readonly triggerRef: RefObject<HTMLElement | null>;
  readonly category: string | null | undefined;
  readonly groups: readonly string[];
  readonly onSelect: (category: string | null) => void;
  readonly onRequestCreate: () => void;
}

/** The native-style group picker stays beside the session action menu. */
export function SessionGroupSubmenu({
  open,
  parentMenuRef,
  triggerRef,
  category,
  groups,
  onSelect,
  onRequestCreate,
}: SessionGroupSubmenuProps) {
  const { t } = useTranslation();
  const submenuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<SessionGroupSubmenuPlacement>({ side: 'right', top: 0 });

  const updatePlacement = useCallback(() => {
    const parent = parentMenuRef.current;
    const trigger = triggerRef.current;
    const submenu = submenuRef.current;
    if (!parent || !trigger || !submenu) return;

    const next = resolveSessionGroupSubmenuPlacement(
      parent.getBoundingClientRect(),
      trigger.getBoundingClientRect(),
      { width: submenu.offsetWidth, height: submenu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPlacement((current) => (
      current.side === next.side && current.top === next.top ? current : next
    ));
  }, [parentMenuRef, triggerRef]);

  useEffect(() => {
    if (!open) return;
    updatePlacement();
    const parent = parentMenuRef.current;
    const submenu = submenuRef.current;
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePlacement)
      : null;
    if (parent && observer) observer.observe(parent);
    if (submenu && observer) observer.observe(submenu);
    window.addEventListener('resize', updatePlacement);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updatePlacement);
    };
  }, [open, parentMenuRef, updatePlacement]);

  if (!open) return null;

  return (
    <div
      ref={submenuRef}
      role="menu"
      aria-label={t('chat.moveSessionToGroup')}
      className={clsx(
        'absolute z-10 max-h-[calc(100vh-16px)] min-w-[196px] overflow-y-auto rounded-lg border border-aegis-menu-border bg-aegis-menu-bg py-1 shadow-[var(--aegis-menu-shadow)]',
        placement.side === 'right' ? 'left-full ml-1' : 'right-full mr-1',
      )}
      style={{ top: placement.top }}
    >
      {groups.map((group) => {
        const selected = category === group;
        return (
          <button
            key={group}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            onClick={() => onSelect(group)}
            className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
          >
            <span className="min-w-0 flex-1 truncate">{group}</span>
            {selected && <Check size={13} className="shrink-0 text-aegis-primary" aria-hidden="true" />}
          </button>
        );
      })}
      {category && (
        <button
          type="button"
          role="menuitem"
          onClick={() => onSelect(null)}
          className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
        >
          {t('chat.removeSessionFromGroup')}
        </button>
      )}
      <div className="my-1 border-t border-aegis-border/70" role="separator" />
      <button
        type="button"
        role="menuitem"
        onClick={onRequestCreate}
        className="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
      >
        <FolderPlus size={13} aria-hidden="true" />
        {t('chat.newSessionGroup')}
      </button>
    </div>
  );
}
