/**
 * Desktop Companion state contract.
 *
 * The main window derives a `PetState` from the live business stores (chat /
 * gateway / workshop / pomodoro) and broadcasts it; the pet window is a thin
 * client that only renders from this state. `derivePetState` (the pure mapping
 * function) decides the single current emotion by priority.
 */

import type { PetSkin } from './skins';

export type PetEmotion =
  | 'idle'
  | 'working' // an agent/session is running
  | 'thinking' // reasoning stream active (pre-first-token)
  | 'typing' // assistant tokens streaming
  | 'tool' // calling a tool
  | 'happy' // a reply just finished
  | 'celebrate' // a workshop task or pomodoro phase just finished
  | 'error' // connection / reply error
  | 'sleepy' // idle for a while
  | 'sleep' // disconnected or idle a long time
  | 'memory' // context compaction in progress
  | 'drag' // OS-level file drag is in flight somewhere over the main window
  | 'overdrag' // the dragged payload is hovering directly over the pet/main
  | 'swallow' // just ate a dropped file / folder — open mouth → chew → return idle
  | 'rapidSwallow'; // a second drop landed before the previous chew finished — "still chewing!"

/** What just finished, when emotion is `celebrate` — lets the bubble pick a specific caption. */
export type CelebrateKind = 'task' | 'pomodoroWork' | 'pomodoroWorkLong' | 'pomodoroBreak';

/** Live Pomodoro state, broadcast so the pet can show focus/break + countdown. */
export interface PetPomodoroState {
  running: boolean;
  paused: boolean;
  phase: 'work' | 'break';
  /** ms remaining in the current phase (frozen while paused). */
  remainingMs: number;
  enabled: boolean;
}

export interface PetState {
  emotion: PetEmotion;
  /** 0-100 — primary session token fill, or workshop task progress. */
  progress?: number;
  /** Short caption for the bubble (thinking text / completion summary). */
  message?: string;
  /** What the pet is busy with (sub-agent label / session name). */
  taskLabel?: string;
  /** Epoch ms — transient `happy`/`celebrate` expires after this. */
  celebrateUntil?: number;
  /** How long the current activity (typing/working/thinking) has been running, in ms. */
  elapsedMs?: number;
  /** Current skin — broadcast so the pet window picks up settings changes. */
  skin?: PetSkin;
  /** Live Pomodoro state — present only when the feature is enabled. */
  pomodoro?: PetPomodoroState;
  /** Present only when emotion === 'celebrate'. */
  celebrateKind?: CelebrateKind;
  /** True while the first-run OpenClaw setup wizard owns the app state. */
  setup?: boolean;
  stats?: { doneToday: number; tokens: number };
  /** Drag in flight — fills in the bubble with file count / type expectations. */
  drag?: {
    /** Number of paths being dragged. */
    count: number;
    /** Coarse file classification (drives bubble icon + accent colour). */
    kind: 'image' | 'archive' | 'code' | 'text' | 'folder' | 'unknown';
    /** True when the cursor is directly over the pet/main window. */
    over: boolean;
  };
  /** Last N swallow timestamps — used to detect "still chewing" and bump rapidSwallow. */
  recentSwallowTss?: number[];
}

export const DEFAULT_PET_STATE: PetState = { emotion: 'idle', progress: 0 };

// ── Phase 2: state derivation ──────────────────────────────────────────────

export interface PetInputs {
  connected: boolean;
  connectionError: string | null;
  thinking: boolean;
  typing: boolean;
  /** Voice input is being captured or transcribed. */
  voiceListening?: boolean;
  /** Assistant audio is queued or currently being spoken. */
  voiceSpeaking?: boolean;
  tool: boolean;
  running: boolean;
  /** Low-priority background work (e.g. memory dreaming cron) is active.
   *  Only surfaces as 'working' when no higher-priority activity is running,
   *  so the pet idles during real work but shows "working" during background
   *  maintenance when it would otherwise be idle. */
  backgroundWork?: boolean;
  /** epoch ms of the most recent reply finalization, or 0 */
  lastReplyTs: number;
  /** epoch ms of the most recent workshop task moved to done, or 0 */
  lastTaskDoneTs: number;
  /** epoch ms of the most recent pomodoro phase completion, or 0 */
  pomodoroDoneTs: number;
  /** which kind of pomodoro phase just completed (read only while pomodoroDoneTs is in the celebrate window) */
  pomodoroDoneKind?: CelebrateKind;
  /** epoch ms of the most recent context compaction, or 0 */
  lastCompactionTs: number;
  /** epoch ms of the last sign of activity */
  lastActivityTs: number;
  /** current time, epoch ms */
  now: number;
  progress: number;
  message?: string;
  taskLabel?: string;
  /** Monotonic counter — every time the user drops a file onto the pet/main,
   *  this bumps. Drives a short swallow animation that takes priority over
   *  everything except genuine connection/sleep states. */
  swallowTick: number;
  /** epoch ms of the most recent swallow trigger (file dropped into pet/main). */
  lastSwallowTs: number;
  /** epoch ms of the most recent drag-enter (file drag entered the main window). */
  lastDragEnterTs: number;
  /** epoch ms of the most recent drag-leave (file drag left the main window). */
  lastDragLeaveTs: number;
  /** True while the cursor sits directly over the pet/main window during a drag. */
  dragOver: boolean;
  /** Number of paths in the current drag payload (0 = no drag). */
  dragCount: number;
  /** Coarse kind of the dragged payload — drives the bubble icon + accent. */
  dragKind: 'image' | 'archive' | 'code' | 'text' | 'folder' | 'unknown' | null;
  /** Rolling window of past swallow timestamps — drives the rapidSwallow
   *  detection (a second drop within RAPID_SWALLOW_GAP of the previous). */
  recentSwallowTss?: number[];
}

const HAPPY_WINDOW = 2500;
const CELEBRATE_WINDOW = 5000; // longer window so pomodoro completions feel rewarding
const MEMORY_WINDOW = 4000;
const SLEEPY_AFTER = 90_000;
const SLEEP_AFTER = 5 * 60_000;
const SWALLOW_WINDOW = 1800; // 吞咽动画时长
const RAPID_SWALLOW_GAP = 1200; // 距离上次吞咽不到这个 ms 就再次吞 → "还在嚼"
const DRAG_WINDOW = 8000; // 拖动进入后,即使没有 move 事件也保持 drag 状态一会儿

/**
 * Pure mapping from live signals → a single emotion, by priority. Trivially
 * unit-testable (no React / store access). Transient emotions (`happy` /
 * `celebrate` / `memory`) only surface in the idle branch — i.e. when nothing
 * is actively running — and expire by timestamp. `celebrate` carries a
 * `celebrateKind` so the bubble can show a task- or pomodoro-specific caption.
 */
export function derivePetState(i: PetInputs): PetState {
  const base = { progress: i.progress, message: i.message, taskLabel: i.taskLabel };
  const dragBubble =
    i.dragCount > 0
      ? { drag: { count: i.dragCount, kind: i.dragKind ?? 'unknown', over: i.dragOver } }
      : null;

  // Swallow / rapidSwallow are transient — the tick bumps on each new drop event
  // and we surface it for SWALLOW_WINDOW ms. If a second drop lands while the
  // previous chew is still playing, we bump to rapidSwallow so the bubble can
  // show "still chewing". Strict priority so the user always sees the mouth
  // reaction even if other emotions are running.
  if (i.lastSwallowTs && i.now - i.lastSwallowTs < SWALLOW_WINDOW) {
    // The usePetStateEmitter feeds a short history; the *last* entry in
    // recentSwallowTss is the current swallowTs (just pushed by
    // bumpSwallowTick), so we look at the *previous* entry to detect
    // back-to-back drops. If the previous drop landed < RAPID_SWALLOW_GAP
    // ms ago, surface rapidSwallow so the bubble can switch caption.
    const recent = i.recentSwallowTss ?? [];
    const prev = recent.length >= 2 ? recent[recent.length - 2] : 0;
    const isRapid = prev > 0 && i.lastSwallowTs - prev < RAPID_SWALLOW_GAP;
    return {
      emotion: isRapid ? 'rapidSwallow' : 'swallow',
      ...base,
      celebrateUntil: i.lastSwallowTs + SWALLOW_WINDOW,
    };
  }

  // Drag-hovering is the next priority — when a file is hanging over the
  // window we want the pet's "open mouth / lock on" cue even if a reply is
  // mid-stream, because the user is actively interacting with the pet.
  if (i.lastDragEnterTs && i.now - i.lastDragEnterTs < DRAG_WINDOW) {
    if (i.lastDragLeaveTs && i.lastDragLeaveTs > i.lastDragEnterTs) {
      // already left — fall through
    } else if (i.dragOver) {
      return { emotion: 'overdrag', ...base, ...dragBubble };
    } else {
      return { emotion: 'drag', ...base, ...dragBubble };
    }
  }

  if (!i.connected) return { emotion: 'sleep', ...base };
  if (i.connectionError) return { emotion: 'error', ...base };

  // Steady active states.
  if (i.voiceListening) return { emotion: 'thinking', ...base };
  if (i.thinking) return { emotion: 'thinking', ...base };
  if (i.tool) return { emotion: 'tool', ...base };
  if (i.voiceSpeaking) return { emotion: 'typing', ...base };
  if (i.typing) return { emotion: 'typing', ...base };
  if (i.running) return { emotion: 'working', ...base };

  // Idle branch — but low-priority background work (dreaming etc.) still counts
  // as "working" so the pet doesn't sleep while the system is maintaining memory.
  if (i.backgroundWork) return { emotion: 'working', ...base };

  // Idle branch: transient celebration windows, then drowsiness.
  if (i.lastCompactionTs && i.now - i.lastCompactionTs < MEMORY_WINDOW)
    return { emotion: 'memory', ...base, celebrateUntil: i.lastCompactionTs + MEMORY_WINDOW };
  if (i.lastTaskDoneTs && i.now - i.lastTaskDoneTs < CELEBRATE_WINDOW)
    return { emotion: 'celebrate', ...base, celebrateUntil: i.lastTaskDoneTs + CELEBRATE_WINDOW, celebrateKind: 'task' };
  if (i.pomodoroDoneTs && i.now - i.pomodoroDoneTs < CELEBRATE_WINDOW)
    return { emotion: 'celebrate', ...base, celebrateUntil: i.pomodoroDoneTs + CELEBRATE_WINDOW, celebrateKind: i.pomodoroDoneKind ?? 'pomodoroWork' };
  if (i.lastReplyTs && i.now - i.lastReplyTs < HAPPY_WINDOW)
    return { emotion: 'happy', ...base, celebrateUntil: i.lastReplyTs + HAPPY_WINDOW };

  const idle = i.now - i.lastActivityTs;
  if (idle > SLEEP_AFTER) return { emotion: 'sleep', ...base };
  if (idle > SLEEPY_AFTER) return { emotion: 'sleepy', ...base };
  return { emotion: 'idle', ...base };
}
