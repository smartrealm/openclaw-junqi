import { useRef, useState } from 'react';

export function PaneResizeHandle({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; value: number } | null>(null);
  const [active, setActive] = useState(false);
  const finish = (element: HTMLDivElement, pointerId: number) => {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    drag.current = null;
    setActive(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const delta = event.key === 'ArrowRight' ? 12 : -12;
        onChange(Math.min(max, Math.max(min, value - delta)));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, x: event.clientX, value };
        event.currentTarget.setPointerCapture(event.pointerId);
        setActive(true);
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const delta = event.clientX - state.x;
        const next = state.value - delta;
        onChange(Math.min(max, Math.max(min, next)));
      }}
      onPointerUp={(event) => finish(event.currentTarget, event.pointerId)}
      onPointerCancel={(event) => finish(event.currentTarget, event.pointerId)}
      className={`absolute inset-y-0 -left-1 z-20 hidden w-[7px] touch-none cursor-col-resize focus-visible:outline-none focus-visible:bg-aegis-primary/35 xl:block ${active ? 'bg-aegis-primary/35' : 'bg-transparent hover:bg-aegis-primary/20'}`}
    />
  );
}
