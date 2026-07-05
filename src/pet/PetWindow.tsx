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
import { usePetStore } from '@/stores/petStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyTheme } from '@/theme/apply';
import { detectOSPreference, resolveTheme } from '@/theme/resolver';
import { isThemeSetting, STORAGE_KEY as THEME_STORAGE_KEY, type ThemeSetting } from '@/theme';
import { playPetSfx } from './petSounds';

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
 *   • Hover → bubble tip visibility (no other UI affordance).
 *   • While dragging the pet scales up slightly ("picked up" feel).
 */
export default function PetWindow() {
  const { t } = useTranslation();
  const [state, setState] = useState<PetState>(DEFAULT_PET_STATE);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
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
  // True while a file drag is in flight over the main window — used so the
  // magnetic-pull effect overrides the snap-back-to-edge animation.
  const isBeingDraggedOverRef = useRef(false);
  // Latest cursor + main-window bounds, written by the `aegis:drag-move`
  // listener and read by the magnetic-pull RAF loop. Module-level state
  // (the listener may not have fired yet when the effect mounts).
  const dragCursorRef = useRef<null | { x: number; y: number; gx: number; gy: number; win_w: number; win_h: number }>(null);

  // ── Theme sync from main window ──
  // The pet window is a separate Tauri window with its own document. Resolve
  // the persisted ThemeSetting here, including "system", so `themeHex()` and
  // `var(--aegis-*)` reflect the active palette in this webview too.
  const theme = useSettingsStore((s) => s.theme);
  // Pull the latest drag state out of the store so we can re-derive the
  // magnetic-pull offsets whenever the cursor moves over the main window.
  // soundEnabled is read on demand inside the effect — no React re-render
  // is required when the user toggles sound in settings.
  const dragActive = usePetStore((s) => s.dragActive);
  const dragOver = usePetStore((s) => s.dragOver);
  useEffect(() => {
    const applyResolved = (setting: ThemeSetting) => {
      applyTheme(resolveTheme(setting, detectOSPreference()));
    };
    applyResolved(theme);

    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY || !isThemeSetting(event.newValue)) return;
      applyResolved(event.newValue);
    };
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSystemTheme = () => {
      const latest = localStorage.getItem(THEME_STORAGE_KEY);
      if (isThemeSetting(latest) && latest === 'system') applyResolved(latest);
    };
    window.addEventListener('storage', onStorage);
    media?.addEventListener('change', onSystemTheme);
    return () => {
      window.removeEventListener('storage', onStorage);
      media?.removeEventListener('change', onSystemTheme);
    };
  }, [theme]);

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
    // CRITICAL: PetWindow is a SEPARATE webview from the main window — its
    // Zustand store is a fresh instance with its own state. The main
    // window's `usePetStore.setDragActive()` call doesn't cross the IPC
    // boundary, so we MUST listen for the drag events ourselves and update
    // our local store. Without this listener, dragActive stays false here
    // and the chase loop never starts.
    const petStore = usePetStore.getState();
    listen<string[]>('aegis:drag-active', (e) => {
      const paths = e.payload ?? [];
      dragCursorRef.current = { x: 0, y: 0, gx: window.screenX + 540, gy: window.screenY + 360, win_w: 1080, win_h: 720 };
      petStore.setDragActive(true, paths);
      isBeingDraggedOverRef.current = true;
    }).then((fn) => unlistens.push(fn)).catch(() => undefined);
    listen<{ x: number; y: number; gx: number; gy: number; win_w: number; win_h: number }>('aegis:drag-move', (e) => {
      dragCursorRef.current = e.payload;
      isBeingDraggedOverRef.current = true;
    }).then((fn) => unlistens.push(fn)).catch(() => undefined);
    listen('aegis:drag-inactive', () => {
      dragCursorRef.current = null;
      petStore.setDragActive(false);
      petStore.setDragOver(false);
      window.setTimeout(() => { isBeingDraggedOverRef.current = false; }, 250);
    }).then((fn) => unlistens.push(fn)).catch(() => undefined);
    // NB: we deliberately do NOT listen for `aegis:file-dropped` here. The
    // swallow emotion (and the leap-to-catch sprint) arrives via the broadcast
    // `pet-state`, and drop also emits `aegis:drag-inactive` which stops the
    // chase — so bumping this window's local swallowTick would be a no-op (the
    // local store isn't read during derivation). The main window owns the drop.
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
      // Restore click-through AFTER release. A short delay keeps the window
      // accepting cursor events long enough for the snap glide to settle
      // without the cursor falling through to the desktop underneath.
      window.setTimeout(() => {
        invoke('set_pet_click_through', { ignore: true }).catch(() => undefined);
      }, 600);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Edge: pet just entered swallow → play the chew sound. Re-uses the same
  // logic as the main window's drop handler so the audio lines up regardless
  // of which window is foregrounded when the payload lands.
  const prevEmotionRef = useRef<PetState['emotion']>(state.emotion);
  useEffect(() => {
    const was = prevEmotionRef.current;
    const now = state.emotion;
    if (was !== 'swallow' && now === 'swallow') {
      playPetSfx('munch', useSettingsStore.getState().soundEnabled);
    }
    prevEmotionRef.current = now;
  }, [state.emotion]);



  // Two-way dash — while the OS reports a drag is in flight and the user is
  // NOT currently hand-dragging the pet, the pet CHASES the cursor with a
  // spring-accelerated motion. This is the "双向奔赴" feel: the cursor is
  // pulling, the pet is leaping, the closer they get the more excited the
  // motion (sinusoidal wobble) until they meet, where the pet snaps into
  // place and waits for the drop. When the user manually drags the pet,
  // auto-motion yields so the user is in full control.
  const dragOffsetRef = useRef<{ dx: number; dy: number; rot: number }>({ dx: 0, dy: 0, rot: 0 });
  const [dragOffset, setDragOffset] = useState({ dx: 0, dy: 0, rot: 0 });
  // Current pet window position in screen coords. Cached locally so the
  // spring loop can advance it without a Rust round-trip per frame.
  const petPosRef = useRef<{ x: number; y: number } | null>(null);
  // Whether auto-chase is currently running — disabled when user is hand-
  // dragging the pet, or when drag isn't active.
  const autoChaseRef = useRef(false);
  useEffect(() => {
    autoChaseRef.current = dragActive && !dragging;
  }, [dragActive, dragging]);

  // Refresh pet position every 250ms so the spring loop has a fresh starting
  // point. Cheaper than a per-frame Rust call.
  useEffect(() => {
    if (!dragActive) return;
    let alive = true;
    const refresh = async () => {
      try {
        const pos = await invoke<{ x: number; y: number }>('get_pet_position');
        if (alive && pos) petPosRef.current = pos;
      } catch { /* ignored */ }
    };
    refresh();
    const id = window.setInterval(refresh, 250);
    return () => { alive = false; clearInterval(id); };
  }, [dragActive]);

  // Whole-screen cursor tracking during a drag. The window-level `Over` event
  // only fires while the cursor is inside the main window, so it can't drive a
  // desktop-wide chase. We ALSO poll the OS global cursor (~33fps) and feed it
  // into dragCursorRef — so the pet follows the payload anywhere on screen,
  // including outside every app window. `aegis:drag-move` stays wired as a
  // faster in-window signal; both write gx/gy in the same logical coord space.
  useEffect(() => {
    if (!dragActive) return;
    let alive = true;
    const id = window.setInterval(async () => {
      try {
        const pos = await invoke<{ x: number; y: number }>('get_cursor_position');
        if (!alive || !pos) return;
        const prev = dragCursorRef.current;
        dragCursorRef.current = prev
          ? { ...prev, gx: pos.x, gy: pos.y }
          : { x: 0, y: 0, gx: pos.x, gy: pos.y, win_w: 1080, win_h: 720 };
      } catch { /* ignored */ }
    }, 30);
    return () => { alive = false; clearInterval(id); };
  }, [dragActive]);

  // Auto-chase spring loop. Runs every animation frame; only mutates the
  // pet window's screen position when auto-chase is enabled.
  useEffect(() => {
    let raf = 0;
    let prevT = performance.now();
    const tick = (t: number) => {
      const dt = Math.max(8, Math.min(48, t - prevT));
      prevT = t;

      if (autoChaseRef.current) {
        const cur = dragCursorRef.current;
        const pos = petPosRef.current;
        if (cur && pos) {
          const dx = cur.gx - (pos.x + 54); // 54 = PET_W/2
          const dy = cur.gy - (pos.y + 77); // 77 = PET_H/2
          const dist = Math.hypot(dx, dy);
          const clamped = Math.min(dist, 600);
          // Spring factor: faster when far, gentler when close.
          const k = clamped > 220 ? 0.22 : clamped > 90 ? 0.15 : 0.08;
          // Sinusoidal "eager" wobble — grows with proximity so the motion
          // looks alive, not robotic.
          const eagerness = Math.min(1, clamped / 320);
          const wobble = Math.sin(t / 110) * 6 * eagerness;
          const len = Math.max(1, dist);
          const perpX = -dy / len;
          const perpY = dx / len;
          const step = clamped * k * (dt / 16);
          const next = {
            x: pos.x + (dx / len) * step + perpX * wobble,
            y: pos.y + (dy / len) * step + perpY * wobble,
          };
          petPosRef.current = next;
          invoke('set_pet_position', next).catch(() => undefined);
          // Tilt toward chase direction — cap ±10°.
          const targetRot = Math.max(-10, Math.min(10, dx / 28));
          const cur2 = dragOffsetRef.current;
          const k2 = 1 - Math.pow(0.001, dt / 1000);
          const tilt = {
            dx: cur2.dx + (dx * 0.06 - cur2.dx) * k2,
            dy: cur2.dy + (dy * 0.06 - cur2.dy) * k2,
            rot: cur2.rot + (targetRot - cur2.rot) * k2,
          };
          dragOffsetRef.current = tilt;
          setDragOffset(tilt);
        }
      } else {
        // Not chasing — smoothly decay the visual tilt.
        const cur2 = dragOffsetRef.current;
        if (Math.hypot(cur2.dx, cur2.dy) > 0.2 || Math.abs(cur2.rot) > 0.2) {
          const next = { dx: cur2.dx * 0.85, dy: cur2.dy * 0.85, rot: cur2.rot * 0.85 };
          dragOffsetRef.current = next;
          setDragOffset(next);
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // On drop (swallow emotion enters), the pet SPRINTS the remaining distance
  // to the cursor — the "leap to catch the falling morsel" gesture.
  useEffect(() => {
    if (state.emotion !== 'swallow') return;
    const cur = dragCursorRef.current;
    const pos = petPosRef.current;
    if (!cur || !pos) return;
    const targetX = cur.gx - 54;
    const targetY = cur.gy - 77;
    const startX = pos.x;
    const startY = pos.y;
    const dur = 180;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      petPosRef.current = {
        x: startX + (targetX - startX) * e,
        y: startY + (targetY - startY) * e,
      };
      invoke('set_pet_position', petPosRef.current).catch(() => undefined);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.emotion]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Capture the start position synchronously so the first mousemove
    // (which can fire before any IPC round-trip resolves) has a usable
    // base. We seed `bx/by` with the current pet position lazily — the
    // async result below refines it once we have the authoritative Rust
    // answer. The first few events may drift by ≤ a frame; negligible.
    drag.current = { sx: e.screenX, sy: e.screenY, bx: e.screenX, by: e.screenY, moved: false, ready: true };
    // Keep click-through OFF for the duration of the press so the OS keeps
    // dispatching events to this window even if the cursor briefly leaves
    // the small PetWindow rect mid-drag.
    invoke('set_pet_click_through', { ignore: false }).catch(() => undefined);
    invoke<{ x: number; y: number }>('get_pet_position')
      .then((base) => {
        if (!drag.current) return;
        // Only refine the base if we haven't started moving yet — otherwise
        // we'd yank the pet back to where it actually was on press.
        if (!drag.current.moved) {
          drag.current.bx = base.x;
          drag.current.by = base.y;
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
      onMouseEnter={() => {
        setHovered(true);
        // CRITICAL: petStore defaults clickThrough to true, which makes
        // Tauri's set_ignore_cursor_events(true) silently swallow every
        // mouseDown / mouseMove on the pet. Without toggling this on
        // hover, the user can't even click the pet, let alone drag it.
        invoke('set_pet_click_through', { ignore: false }).catch(() => undefined);
      }}
      onMouseLeave={() => {
        setHovered(false);
        // Re-arm click-through so the pet never blocks the desktop. A
        // 200ms grace keeps it interactive during quick cursor slips.
        window.setTimeout(() => {
          if (!dragging) invoke('set_pet_click_through', { ignore: true }).catch(() => undefined);
        }, 200);
      }}
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
      <div style={{ position: 'relative' }}>
        <PetCharacter
          emotion={state.emotion}
          progress={state.progress ?? 0}
          skin={state.skin ?? skin}
          customAsset={customAsset}
          dragging={dragging}
          celebrating={state.emotion === 'celebrate'}
          dragDx={dragOffset.dx}
          dragDy={dragOffset.dy}
          dragRotation={dragOffset.rot}
        />
        {BadgeIcon && (
          <motion.span
            style={{ position: 'absolute', top: -22, right: 4, color: badgeColor, pointerEvents: 'none', filter: 'none' }}
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
