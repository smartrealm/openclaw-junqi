import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { PetCharacter } from './PetCharacter';
import { PetBubble } from './PetBubble';
import { DEFAULT_PET_STATE, type PetState } from './pet-states';
import { usePetStore } from '@/stores/petStore';

/** Pixels the cursor must travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;

/**
 * Root of the transparent floating pet window — a thin client.
 *
 * It does NOT connect to the gateway: it only listens for "pet-state" (emitted
 * by the main window) and "pet-moved" (emitted by Rust when dragged) and renders
 * the character.
 *
 * Interaction:
 *   • Press & slide → drag the pet (manual JS drag via set_pet_position; more
 *     reliable than data-tauri-drag-region on transparent windows, and keeps
 *     working even after the cursor leaves the tiny window mid-drag).
 *   • Double-click → surface the main window.
 *   • While dragging the pet scales up slightly ("picked up" feel).
 */
export default function PetWindow() {
  const [state, setState] = useState<PetState>(DEFAULT_PET_STATE);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const position = usePetStore((s) => s.position);
  const setPosition = usePetStore((s) => s.setPosition);
  const skin = usePetStore((s) => s.skin);
  const customAsset = usePetStore((s) => s.customAsset);
  const setCustomAsset = usePetStore((s) => s.setCustomAsset);

  const drag = useRef<{ sx: number; sy: number; bx: number; by: number; moved: boolean; ready: boolean } | null>(null);
  // Suppress the dblclick that the OS sometimes synthesizes right after a drag.
  const justDragged = useRef(false);

  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';

    if (position && typeof position.x === 'number' && typeof position.y === 'number') {
      invoke('set_pet_position', position).catch(() => undefined);
    }
    // Load a user-uploaded custom skin from disk (not persisted in localStorage).
    invoke<string | null>('load_pet_asset')
      .then((url) => {
        if (url) setCustomAsset(url);
      })
      .catch(() => undefined);

    const unlistens: UnlistenFn[] = [];
    listen<PetState>('pet-state', (e) => setState(e.payload))
      .then((fn) => unlistens.push(fn))
      .catch(() => undefined);
    listen<{ x: number; y: number }>('pet-moved', (e) => setPosition(e.payload))
      .then((fn) => unlistens.push(fn))
      .catch(() => undefined);
    return () => unlistens.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global mouse listeners so dragging keeps tracking even after the cursor
  // leaves the small pet window.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d || !d.ready) return;
      const dx = e.screenX - d.sx;
      const dy = e.screenY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) invoke('set_pet_position', { x: d.bx + dx, y: d.by + dy });
    };
    const onUp = () => {
      const d = drag.current;
      if (d?.moved) {
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 350);
      }
      drag.current = null;
      setDragging(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    drag.current = { sx: e.screenX, sy: e.screenY, bx: 0, by: 0, moved: false, ready: false };
    invoke<{ x: number; y: number }>('get_pet_position')
      .then((base) => {
        if (drag.current) {
          drag.current.bx = base.x;
          drag.current.by = base.y;
          drag.current.ready = true;
        }
      })
      .catch(() => undefined);
  };

  const onDoubleClick = () => {
    if (justDragged.current) return;
    invoke('pet_focus_main').catch(() => undefined);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        cursor: dragging ? 'grabbing' : 'grab',
        transform: dragging ? 'scale(1.08)' : 'scale(1)',
        transition: 'transform 0.15s ease',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <PetBubble state={state} dragging={dragging} hovered={hovered} />
      <PetCharacter emotion={state.emotion} progress={state.progress ?? 0} skin={skin} customAsset={customAsset} />
    </div>
  );
}
