import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { pomodoroIcon, pomodoroColor } from './pomodoroView';
import { computeSnapTarget, easeOutCubic, type PetBounds } from './snap';
import { PetCharacter } from './PetCharacter';
import { PetBubble } from './PetBubble';
import { DEFAULT_PET_STATE, type PetState } from './pet-states';
import type { PetMenuItem } from './petActions';
import { X } from 'lucide-react';
import { usePetStore } from '@/stores/petStore';

/** Pixels the cursor must travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;
/** Pet logical size — must match Rust `open_pet_window` (108×154). */
const PET_W = 108;
const PET_H = 154;
/** Release within this many px of an edge → snap; mid-screen is left alone. */
const SNAP_THRESHOLD = 90;
/** Gap left between the pet and the edge after snapping. */
const SNAP_MARGIN = 6;

/**
 * Root of the transparent floating pet window — a thin client.
 *
 * It does NOT connect to the gateway or hold the timer: it only listens for
 * "pet-state" (emitted by the main window) and "pet-moved" (emitted by Rust
 * when dragged) and renders the character. State-changing actions (skin cycle,
 * pomodoro control) are forwarded to the main window via the "pet-action"
 * event, since the main window owns the live timer and the authoritative store.
 *
 * Interaction:
 *   • Press & slide → drag the pet (manual JS drag via set_pet_position).
 *   • Double-click → surface & focus the main window.
 *   • Right-click → native context menu (main window / next skin / hide /
 *     pomodoro control when enabled).
 *   • While dragging the pet scales up slightly ("picked up" feel).
 */
export default function PetWindow() {
  const { t } = useTranslation();
  const [state, setState] = useState<PetState>(DEFAULT_PET_STATE);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  // Theme-aware so the hide button and other overlays can pick a legible color.
  const [isDark, setIsDark] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDark(mq.matches);
    const onChange = () => setIsDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  // True while the magnetic-snap glide is moving the window. The window moving
  // under a still cursor makes hovered flicker (mouseenter/leave), which would
  // make the tip bubble strobe — so we suppress hover-driven tips while snapping.
  const [snapping, setSnapping] = useState(false);
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
    // Custom asset changed in the main window (upload/clear) → reload from disk.
    listen('pet-asset-changed', () => {
      invoke<string | null>('load_pet_asset')
        .then((url) => setCustomAsset(url ?? null))
        .catch(() => undefined);
    })
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
    // Magnetic snap: if the pet is released close to a screen edge, glide it to
    // that edge. Releases in the middle of the screen are left untouched.
    // Geometry is pure (snap.ts); this helper only owns the IO + animation.
    const glideTo = (fromX: number, fromY: number, toX: number, toY: number, onDone?: () => void) => {
      const dur = 200;
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const e = easeOutCubic(t);
        invoke('set_pet_position', { x: fromX + (toX - fromX) * e, y: fromY + (toY - fromY) * e });
        if (t < 1) requestAnimationFrame(step);
        else onDone?.();
      };
      requestAnimationFrame(step);
    };
    const snapToEdge = () => {
      setSnapping(true);
      Promise.all([
        invoke<{ x: number; y: number }>('get_pet_position'),
        invoke<PetBounds>('get_pet_bounds'),
      ])
        .then(([pos, b]) => {
          const target = computeSnapTarget({ x: pos.x, y: pos.y, w: PET_W, h: PET_H }, b, SNAP_THRESHOLD, SNAP_MARGIN);
          if (!target || (Math.abs(target.x - pos.x) < 1 && Math.abs(target.y - pos.y) < 1)) {
            setSnapping(false);
            return;
          }
          glideTo(pos.x, pos.y, target.x, target.y, () => setSnapping(false));
        })
        .catch(() => setSnapping(false));
    };
    const onUp = () => {
      const d = drag.current;
      if (d?.moved) {
        justDragged.current = true;
        window.setTimeout(() => {
          justDragged.current = false;
        }, 350);
        snapToEdge();
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

  // Right-click → native menu built from i18n labels. Rust only pops the menu
  // and reports the clicked kind back via "pet-action"; labels stay here so
  // localization (incl. Arabic RTL) is handled by the native menu renderer.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const p = state.pomodoro;
    const items: PetMenuItem[] = [
      { kind: 'showMain', label: t('pet.menu.showMain', '显示主窗口') },
      { kind: 'nextSkin', label: t('pet.menu.nextSkin', '下一皮肤') },
      { kind: 'hide', label: t('pet.menu.hide', '隐藏萌宠') },
    ];
    if (p?.enabled) {
      items.push({ kind: 'sep', label: '' });
      if (p.running) {
        items.push({ kind: 'pomoPause', label: p.paused ? t('pet.pomodoro.resume', '继续') : t('pet.pomodoro.pause', '暂停') });
        items.push({ kind: 'pomoStop', label: t('pet.pomodoro.stop', '停止') });
      } else {
        items.push({ kind: 'pomoStart', label: t('pet.pomodoro.start', '开始') });
      }
    }
    invoke('pet_show_context_menu', { items }).catch(() => undefined);
  };

  // Pomodoro badge over the character's head — vector Lucide icon, not emoji.
  const pomoBadge = state.pomodoro?.enabled && state.pomodoro.running ? state.pomodoro : null;
  const BadgeIcon = pomoBadge ? pomodoroIcon(pomoBadge) : null;
  const badgeColor = pomoBadge ? pomodoroColor(pomoBadge) : '';

  return (
    <div
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
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
        transition: 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
        WebkitUserSelect: 'none',
        userSelect: 'none',
      }}
    >
      <PetBubble state={state} dragging={dragging} hovered={hovered && !snapping} />
      {/* Obvious "hide" affordance — the transparent window has no chrome, so
          without this button users have no way to find the right-click / tray /
          ⌘⇧H / settings-page route to dismiss the pet. */}
      <button
        onClick={() => invoke('close_pet_window').catch(() => undefined)}
        aria-label={t('pet.hint.hidePet', '隐藏萌宠')}
        className="absolute top-2 left-2 z-10 flex items-center justify-center w-5 h-5 rounded-full opacity-50 hover:opacity-100 hover:bg-white/15 transition-opacity"
        style={{ color: isDark ? '#ffffff' : '#16181f' }}
      >
        <X size={12} strokeWidth={2.4} />
      </button>
      <div style={{ position: 'relative' }}>
        <PetCharacter emotion={state.emotion} progress={state.progress ?? 0} skin={state.skin ?? skin} customAsset={customAsset} dragging={dragging} />
        {BadgeIcon && (
          <motion.span
            style={{ position: 'absolute', top: -1, right: 4, color: badgeColor, pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
            animate={{ y: [0, -2, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <BadgeIcon size={15} strokeWidth={2.4} />
          </motion.span>
        )}
      </div>
    </div>
  );
}
