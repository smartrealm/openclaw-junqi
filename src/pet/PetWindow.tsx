import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import { applyAccentColor, isAccentColor, readPersistedAccentColor } from '@/theme/accent';
import { detectOSPreference, resolveTheme } from '@/theme/resolver';
import { STORAGE_KEY as THEME_STORAGE_KEY } from '@/theme/constants';
import { isThemeSetting, type ThemeSetting } from '@/theme/types';
import { playPetSfx } from './petSounds';
import { combineUnlisteners, subscribeTauriEvent } from '@/utils/tauriEvents';
import { PetPositionScheduler } from './petPositionScheduler';

/** Pixels the cursor must travel before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 3;
/** Pet logical size — must match Rust `open_pet_window` (108×154). */
const PET_W = 108;
const PET_H = 154;
/** Release within this many px of an edge → snap; mid-screen is left alone. */
const SNAP_THRESHOLD = 90;
/** Gap left between the pet and the edge after snapping. */
const SNAP_MARGIN = 6;
const PENDING_PACKAGE_AFTER_KEY = 'junqi:pet-package-pending-after';

const createPositionScheduler = () => new PetPositionScheduler((point) =>
  invoke('set_pet_position', { x: point.x, y: point.y }),
);

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
  // Horizontal hand-drag direction (-1 left / +1 right / 0 idle), driven off
  // the raw mousemove so the lobster's legs stride the way it's being carried.
  const [walkDir, setWalkDir] = useState(0);
  const walkDirRef = useRef(0);
  const lastMoveXRef = useRef<number | null>(null);
  const position = usePetStore((s) => s.position);
  const setPosition = usePetStore((s) => s.setPosition);
  const skin = usePetStore((s) => s.skin);
  const customAsset = usePetStore((s) => s.customAsset);
  const setCustomAsset = usePetStore((s) => s.setCustomAsset);
  const customPet = usePetStore((s) => s.customPet);
  const setCustomPet = usePetStore((s) => s.setCustomPet);
  const positionRef = useRef(position);
  positionRef.current = position;
  const positionSchedulerRef = useRef<PetPositionScheduler | null>(null);
  if (!positionSchedulerRef.current) {
    positionSchedulerRef.current = createPositionScheduler();
  }
  useEffect(() => {
    const scheduler = positionSchedulerRef.current ?? createPositionScheduler();
    positionSchedulerRef.current = scheduler;
    return () => {
      scheduler.dispose();
      if (positionSchedulerRef.current === scheduler) {
        positionSchedulerRef.current = null;
      }
    };
  }, []);

  const drag = useRef<{ sx: number; sy: number; bx: number; by: number; moved: boolean; ready: boolean; native: boolean } | null>(null);
  // Suppress the dblclick that the OS sometimes synthesizes right after a drag.
  const justDragged = useRef(false);
  // Latest cursor + main-window bounds, written by the `aegis:drag-move`
  // listener and read by the magnetic-pull RAF loop. Module-level state
  // (the listener may not have fired yet when the effect mounts).
  const dragCursorRef = useRef<null | { x: number; y: number; gx: number; gy: number; win_w: number; win_h: number }>(null);
  const timeoutsRef = useRef<number[]>([]);

  const defer = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timeoutsRef.current = timeoutsRef.current.filter((timeoutId) => timeoutId !== id);
      fn();
    }, ms);
    timeoutsRef.current.push(id);
    return id;
  };

  // ── Theme sync from main window ──
  // The pet window is a separate Tauri window with its own document. Resolve
  // the persisted ThemeSetting here, including "system", and mirror the accent
  // token so SVG/CSS variables reflect the same palette as the main window.
  const theme = useSettingsStore((s) => s.theme);
  // Pull the latest drag state out of the store so we can re-derive the
  // magnetic-pull offsets whenever the cursor moves over the main window.
  // soundEnabled is read on demand inside the effect — no React re-render
  // is required when the user toggles sound in settings.
  const dragActive = usePetStore((s) => s.dragActive);
  const snapCancelRef = useRef<(() => void) | null>(null);
  const cancelSnap = useCallback(() => {
    snapCancelRef.current?.();
    snapCancelRef.current = null;
    setSnapping(false);
  }, []);
  useLayoutEffect(() => {
    const applyResolved = (setting: ThemeSetting) => {
      applyTheme(resolveTheme(setting, detectOSPreference()));
      const accent = readPersistedAccentColor();
      if (accent) applyAccentColor(accent);
    };
    applyResolved(theme);

    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY && isThemeSetting(event.newValue)) {
        applyResolved(event.newValue);
        return;
      }
      if (event.key === 'aegis-accent-color') {
        if (isAccentColor(event.newValue)) applyAccentColor(event.newValue);
      }
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
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.backgroundColor = 'transparent';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    const appRoot = document.getElementById('app-root');
    if (appRoot) {
      appRoot.style.background = 'transparent';
      appRoot.style.backgroundColor = 'transparent';
    }
    invoke('set_pet_click_through', { ignore: false }).catch(() => undefined);

    const initialPosition = positionRef.current;
    if (initialPosition && typeof initialPosition.x === 'number' && typeof initialPosition.y === 'number') {
      invoke('set_pet_position', initialPosition).catch(() => undefined);
    }
    // Animated v2 packages take precedence over legacy single-image skins.
    const activatePendingPackage = async () => {
      const after = Number(localStorage.getItem(PENDING_PACKAGE_AFTER_KEY));
      if (!Number.isFinite(after) || after <= 0) return false;
      const latest = await invoke<import('@/stores/petStore').CustomPetPackage | null>('activate_latest_pet_package', {
        newerThanUnixMs: Math.trunc(after),
      });
      if (!latest) return false;
      setCustomPet(latest);
      setCustomAsset(null);
      localStorage.removeItem(PENDING_PACKAGE_AFTER_KEY);
      return true;
    };

    invoke<import('@/stores/petStore').CustomPetPackage | null>('load_pet_package')
      .then((pet) => {
        if (pet) {
          setCustomPet(pet);
          setCustomAsset(null);
        } else {
          setCustomPet(null);
        }
        return activatePendingPackage();
      })
      .catch(() => undefined);
    // A chat can finish after this always-on-top window is already open.
    // Poll only while there is a pending request, and stop as soon as its
    // validated v2 package becomes active.
    const pendingTimer = window.setInterval(() => {
      void activatePendingPackage().catch(() => undefined);
    }, 5_000);
    invoke<string | null>('load_pet_asset')
      .then((url) => {
        if (url && !usePetStore.getState().customPet) setCustomAsset(url);
      })
      .catch(() => undefined);

    const unlistens = [
      subscribeTauriEvent<PetState>('pet-state', (e) => setState(e.payload)),
      subscribeTauriEvent<{ x: number; y: number }>('pet-moved', (e) => {
        const previous = petPosRef.current;
        if (drag.current?.native && previous) {
          const deltaX = e.payload.x - previous.x;
          if (Math.abs(deltaX) > 0.5) {
            const direction = deltaX > 0 ? 1 : -1;
            if (direction !== walkDirRef.current) {
              walkDirRef.current = direction;
              setWalkDir(direction);
            }
          }
        }
        positionRef.current = e.payload;
        petPosRef.current = e.payload;
      }),
    ];
    // CRITICAL: PetWindow is a SEPARATE webview from the main window — its
    // Zustand store is a fresh instance with its own state. The main
    // window's `usePetStore.setDragActive()` call doesn't cross the IPC
    // boundary, so we MUST listen for the drag events ourselves and update
    // our local store. Without this listener, dragActive stays false here
    // and the chase loop never starts.
    const petStore = usePetStore.getState();
    unlistens.push(
      subscribeTauriEvent<string[]>('aegis:drag-active', (e) => {
        const paths = e.payload ?? [];
        dragCursorRef.current = { x: 0, y: 0, gx: window.screenX + 540, gy: window.screenY + 360, win_w: 1080, win_h: 720 };
        petStore.setDragActive(true, paths);
        cancelSnap();
      }),
      subscribeTauriEvent<{ x: number; y: number; gx: number; gy: number; win_w: number; win_h: number }>('aegis:drag-move', (e) => {
        dragCursorRef.current = e.payload;
        cancelSnap();
      }),
      subscribeTauriEvent('aegis:drag-inactive', () => {
        dragCursorRef.current = null;
        petStore.setDragActive(false);
        petStore.setDragOver(false);
        if (petPosRef.current) petStore.setPosition(petPosRef.current);
      }),
    );
    // NB: we deliberately do NOT listen for `aegis:file-dropped` here. The
    // swallow emotion (and the leap-to-catch sprint) arrives via the broadcast
    // `pet-state`, and drop also emits `aegis:drag-inactive` which stops the
    // chase — so bumping this window's local swallowTick would be a no-op (the
    // local store isn't read during derivation). The main window owns the drop.
    // Custom asset changed in the main window (upload/clear) → reload from disk.
    unlistens.push(
      subscribeTauriEvent('pet-asset-changed', () => {
        invoke<string | null>('load_pet_asset')
          .then((url) => {
            setCustomAsset(url ?? null);
            if (url) setCustomPet(null);
          })
          .catch(() => undefined);
      }),
      subscribeTauriEvent('pet-package-changed', () => {
        invoke<import('@/stores/petStore').CustomPetPackage | null>('load_pet_package')
          .then((pet) => {
            setCustomPet(pet);
            if (pet) setCustomAsset(null);
          })
          .catch(() => undefined);
      }),
    );
    return () => {
      window.clearInterval(pendingTimer);
      return combineUnlisteners(unlistens)();
    };
  }, [cancelSnap, setCustomAsset, setCustomPet]);

  // Global mouse listeners so dragging keeps tracking even after the cursor
  // leaves the small pet window.
  useEffect(() => {
    let active = true;
    const onMove = (e: MouseEvent) => {
      const d = drag.current;
      if (!d || !d.ready) return;
      const dx = e.screenX - d.sx;
      const dy = e.screenY - d.sy;
      if (!d.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        cancelSnap();
        d.moved = true;
        d.native = true;
        setDragging(true);
        invoke('start_pet_dragging').catch(() => {
          if (drag.current === d) d.native = false;
        });
      }
      if (d.moved && !d.native) {
        const next = { x: d.bx + dx, y: d.by + dy };
        petPosRef.current = next;
        positionSchedulerRef.current?.enqueue(next);
        // Track instantaneous horizontal direction; only re-render when the
        // sign flips so a fast drag doesn't thrash React.
        const lastX = lastMoveXRef.current;
        if (lastX != null) {
          const vx = e.screenX - lastX;
          if (Math.abs(vx) > 0.75) {
            const nd = vx > 0 ? 1 : -1;
            if (nd !== walkDirRef.current) {
              walkDirRef.current = nd;
              setWalkDir(nd);
            }
          }
        }
        lastMoveXRef.current = e.screenX;
      }
    };
    // Magnetic snap: if the pet is released close to a screen edge, glide it to
    // that edge. Releases in the middle of the screen are left untouched.
    // Geometry is pure (snap.ts); this helper only owns the IO + animation.
    const glideTo = (fromX: number, fromY: number, toX: number, toY: number, onDone?: () => void) => {
      const dur = 200;
      const start = performance.now();
      let raf = 0;
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const e = easeOutCubic(t);
        const next = { x: fromX + (toX - fromX) * e, y: fromY + (toY - fromY) * e };
        petPosRef.current = next;
        positionSchedulerRef.current?.enqueue(next);
        if (t < 1) raf = requestAnimationFrame(step);
        else {
          positionSchedulerRef.current?.flush();
          onDone?.();
        }
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    };
    const snapToEdge = () => {
      setSnapping(true);
      const cachedPosition = petPosRef.current;
      const positionPromise = cachedPosition
        ? Promise.resolve(cachedPosition)
        : invoke<{ x: number; y: number }>('get_pet_position');
      Promise.all([positionPromise, invoke<PetBounds>('get_pet_bounds')])
        .then(([pos, b]) => {
          if (!active) return;
          const target = computeSnapTarget({ x: pos.x, y: pos.y, w: PET_W, h: PET_H }, b, SNAP_THRESHOLD, SNAP_MARGIN);
          if (!target || (Math.abs(target.x - pos.x) < 1 && Math.abs(target.y - pos.y) < 1)) {
            setSnapping(false);
            return;
          }
          snapCancelRef.current = glideTo(pos.x, pos.y, target.x, target.y, () => {
            snapCancelRef.current = null;
            setSnapping(false);
            setPosition(target);
          });
        })
        .catch(() => {
          if (active) setSnapping(false);
        });
    };
    const onUp = () => {
      const d = drag.current;
      if (d?.moved) {
        positionSchedulerRef.current?.flush();
        if (petPosRef.current) setPosition(petPosRef.current);
        justDragged.current = true;
        defer(() => {
          justDragged.current = false;
        }, 350);
        snapToEdge();
      }
      drag.current = null;
      setDragging(false);
      // Feet come to rest.
      walkDirRef.current = 0;
      lastMoveXRef.current = null;
      setWalkDir(0);
    };
    const nativeDragEnded = subscribeTauriEvent('pet-drag-ended', onUp);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      active = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      nativeDragEnded();
      cancelSnap();
      for (const id of timeoutsRef.current) window.clearTimeout(id);
      timeoutsRef.current = [];
    };
  }, [cancelSnap, setPosition]);

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

  // Auto-chase spring loop. It exists only while an external file drag is in
  // flight. Keeping a permanent RAF here made the transparent pet window do
  // work while idle and compounded WebGL rendering on lower-end Windows PCs.
  useEffect(() => {
    if (!dragActive || dragging) {
      const current = dragOffsetRef.current;
      if (Math.hypot(current.dx, current.dy) > 0.2 || Math.abs(current.rot) > 0.2) {
        const reset = { dx: 0, dy: 0, rot: 0 };
        dragOffsetRef.current = reset;
        setDragOffset(reset);
      }
      return;
    }

    let raf = 0;
    let prevT = performance.now();
    const tick = (t: number) => {
      const dt = Math.max(8, Math.min(48, t - prevT));
      prevT = t;

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
        positionSchedulerRef.current?.enqueue(next);
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

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [dragActive, dragging]);

  // On drop (swallow emotion enters), the pet SPRINTS the remaining distance
  // to the cursor — the "leap to catch the falling morsel" gesture.
  useEffect(() => {
    if (state.emotion !== 'swallow') return;
    cancelSnap();
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
      positionSchedulerRef.current?.enqueue(petPosRef.current);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cancelSnap, state.emotion]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Capture the start position synchronously so the first mousemove
    // (which can fire before any IPC round-trip resolves) has a usable
    // base. We seed `bx/by` with the current pet position lazily — the
    // async result below refines it once we have the authoritative Rust
    // answer. The first few events may drift by ≤ a frame; negligible.
    const cached = petPosRef.current ?? positionRef.current;
    drag.current = {
      sx: e.screenX,
      sy: e.screenY,
      bx: cached?.x ?? 0,
      by: cached?.y ?? 0,
      moved: false,
      ready: Boolean(cached),
      native: false,
    };
    cancelSnap();
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
        drag.current.ready = true;
        petPosRef.current = base;
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
    const menuLabel = (key: string, fallback: string) => {
      const value = t(key, fallback);
      return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    };
    const compactItems = (items: PetMenuItem[]): PetMenuItem[] => {
      const filtered: PetMenuItem[] = [];
      for (const item of items) {
        if (item.kind !== 'sep' && !item.label.trim()) continue;
        if (item.kind === 'sep' && (filtered.length === 0 || filtered[filtered.length - 1]?.kind === 'sep')) continue;
        filtered.push(item);
      }
      while (filtered[filtered.length - 1]?.kind === 'sep') filtered.pop();
      return filtered.length > 0 ? filtered : [{ kind: 'showMain', label: menuLabel('pet.menu.showMain', '显示主窗口') }];
    };
    const items: PetMenuItem[] = [
      { kind: 'showMain', label: menuLabel('pet.menu.showMain', '显示主窗口') },
      { kind: 'nextSkin', label: menuLabel('pet.menu.nextSkin', '下一皮肤') },
      { kind: 'hide', label: menuLabel('pet.menu.hide', '隐藏萌宠') },
    ];
    if (p?.enabled) {
      items.push({ kind: 'sep', label: '' });
      if (p.running) {
        items.push({
          kind: 'pomoPause',
          label: p.paused ? menuLabel('pet.menu.pomoResume', '继续番茄钟') : menuLabel('pet.menu.pomoPause', '暂停番茄钟'),
        });
        items.push({ kind: 'pomoStop', label: menuLabel('pet.menu.pomoStop', '停止番茄钟') });
      } else {
        items.push({ kind: 'pomoStart', label: menuLabel('pet.menu.pomoStart', '开始番茄钟') });
      }
    }
    invoke('pet_show_context_menu', { items: compactItems(items) }).catch(() => undefined);
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
        invoke('set_pet_click_through', { ignore: false }).catch(() => undefined);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        background: 'transparent',
        cursor: dragging ? 'grabbing' : 'grab',
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
          customPet={customPet}
          dragging={dragging}
          hovered={hovered && !snapping && !dragging}
          walkDir={walkDir}
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
