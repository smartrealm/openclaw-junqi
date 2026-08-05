import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface FloatingMenuPoint {
  readonly x: number;
  readonly y: number;
}

interface FloatingMenuSize {
  readonly width: number;
  readonly height: number;
}

interface FloatingMenuViewport {
  readonly width: number;
  readonly height: number;
}

export type FloatingMenuOrigin = 'top-start' | 'top-end';

const VIEWPORT_GUTTER_PX = 8;

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(Math.max(value, lower), Math.max(lower, upper));
}

export function resolveFloatingMenuPosition(
  point: FloatingMenuPoint,
  size: FloatingMenuSize,
  viewport: FloatingMenuViewport,
  origin: FloatingMenuOrigin = 'top-start',
): FloatingMenuPoint {
  const preferredX = origin === 'top-end' ? point.x - size.width : point.x;
  return {
    x: clamp(preferredX, VIEWPORT_GUTTER_PX, viewport.width - size.width - VIEWPORT_GUTTER_PX),
    y: clamp(point.y, VIEWPORT_GUTTER_PX, viewport.height - size.height - VIEWPORT_GUTTER_PX),
  };
}

interface FloatingMenuPortalProps {
  readonly point: FloatingMenuPoint;
  readonly onDismiss: () => void;
  readonly origin?: FloatingMenuOrigin;
  readonly children: ReactNode;
}

/**
 * Shared context-menu host for desktop surfaces. Rendering at document level
 * keeps menus outside scrolling and clipping containers while retaining a
 * single viewport-collision policy.
 */
export function FloatingMenuPortal({
  point,
  onDismiss,
  origin = 'top-start',
  children,
}: FloatingMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingMenuPoint>(point);

  const updatePosition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const next = resolveFloatingMenuPosition(
      point,
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      origin,
    );
    setPosition((current) => (
      current.x === next.x && current.y === next.y ? current : next
    ));
  }, [origin, point]);

  useEffect(() => {
    updatePosition();
    const menu = menuRef.current;
    const observer = menu && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updatePosition)
      : null;
    if (menu && observer) observer.observe(menu);

    const dismissWhenOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onDismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', dismissWhenOutside);
    window.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('resize', updatePosition);
    return () => {
      observer?.disconnect();
      document.removeEventListener('mousedown', dismissWhenOutside);
      window.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('resize', updatePosition);
    };
  }, [onDismiss, updatePosition]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[2147483647]"
      style={{ left: position.x, top: position.y }}
    >
      {children}
    </div>,
    document.body,
  );
}
