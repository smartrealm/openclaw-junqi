import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import { IS_MAC_WEBKIT } from "./platform";
import type { ThemeVariant } from "../../_nezha_root/types";
// Explicit contract for xterm private field access — see types.ts header.
import type { XTermWithPrivates } from "./types";

// xterm 6's custom scrollbar width is controlled by overviewRuler.width reuse;
// FitAddon uses it to compute available columns, so it must match the CSS
// scrollbar gutter width.
const XTERM_SCROLLBAR_WIDTH = 12;

// ── Theme ────────────────────────────────────────────────────────────────────

export const DARK_THEME = {
  background: "#1e2230",
  foreground: "#cdd6f4",
  cursor: "#cdd6f4",
  selectionBackground: "#45475a",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#d2a8ff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#f0a1ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

export const LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#24292f",
  cursor: "#24292f",
  selectionBackground: "#b3d7ff",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0550ae",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#633c01",
  brightBlue: "#0969da",
  brightMagenta: "#6639ba",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

// Midnight dark: same syntax palette as DARK_THEME, but a neutral near-black
// background (#1A1B1D) to match the `html.midnight` --bg-panel surface.
export const MIDNIGHT_THEME = {
  ...DARK_THEME,
  background: "#1a1b1d",
};

// Solarized Light-inspired warm palette to match the eyecare CSS tokens.
export const EYECARE_THEME = {
  background: "#fdf6e3",
  foreground: "#586e75",
  cursor: "#586e75",
  selectionBackground: "#eee8d5",
  black: "#073642",
  red: "#dc322f",
  green: "#859900",
  yellow: "#b58900",
  blue: "#268bd2",
  magenta: "#d33682",
  cyan: "#2aa198",
  white: "#93a1a1",
  brightBlack: "#657b83",
  brightRed: "#cb4b16",
  brightGreen: "#586e75",
  brightYellow: "#657b83",
  brightBlue: "#839496",
  brightMagenta: "#6c71c4",
  brightCyan: "#93a1a1",
  brightWhite: "#fdf6e3",
};

export function themeFor(variant: ThemeVariant) {
  if (variant === "dark") return DARK_THEME;
  if (variant === "midnight") return MIDNIGHT_THEME;
  if (variant === "eyecare") return EYECARE_THEME;
  return LIGHT_THEME;
}

export function minimumContrastRatioFor(variant: ThemeVariant): number {
  // Dark-family variants (dark / midnight) ship a hand-tuned palette already
  // readable on their backgrounds, so we skip xterm's auto contrast lift to
  // preserve the original ANSI hues. Light-family variants (light / eyecare)
  // pair light surfaces with high-saturation ANSI defaults that fall below
  // WCAG AA — there we let xterm bump foregrounds until they hit 4.5:1.
  return variant === "dark" || variant === "midnight" ? 1 : 4.5;
}

// Terminal embedded on var(--bg-panel) surface (agent task terminal / embedded
// shell) replaces xterm background from theme preset with actual --bg-panel value,
// eliminating color difference at the terminal boundary vs. outer panel.
// dark/eyecare presets differ from --bg-panel; this function converges both
// terminal entry points onto a single path.
function themeOnPanel(variant: ThemeVariant, container: HTMLElement) {
  const theme = themeFor(variant);
  const background = window
    .getComputedStyle(container)
    .getPropertyValue("--bg-panel")
    .trim();
  return background ? { ...theme, background } : theme;
}

export function applyTerminalThemeOnPanel(
  term: Terminal,
  variant: ThemeVariant,
  container: HTMLElement,
): void {
  term.options.theme = themeOnPanel(variant, container);
  term.options.minimumContrastRatio = minimumContrastRatioFor(variant);
}

// ── Watermark flow control ───────────────────────────────────────────────────

const HIGH_WATER = 128 * 1024; // 128 KB: pause writing when exceeded
const LOW_WATER = 16 * 1024; // 16 KB: resume writing

export interface SmartWriter {
  write: (data: string, callback?: () => void) => void;
  drainPending: () => void;
  setSelectionPaused: (paused: boolean) => void;
}

interface TerminalSelectionGuardOptions {
  term: Terminal;
  container: HTMLElement;
  writer?: Pick<SmartWriter, "setSelectionPaused">;
}

function setMacWebKitTextareaAttrs(term: Terminal): void {
  if (!term.textarea) return;
  term.textarea.setAttribute("autocomplete", "off");
  term.textarea.setAttribute("autocorrect", "off");
  term.textarea.setAttribute("autocapitalize", "off");
  term.textarea.setAttribute("spellcheck", "false");
  // Hint WKWebView that candidate bar UI is not needed, skipping the
  // EditorState::stringForCandidateRequest path for ICU cluster analysis —
  // this path runs every willCommitMainFrameData frame even when textarea
  // is blurred, uncovered by the spellcheck=false trio alone.
  term.textarea.setAttribute("inputmode", "none");
}

// macOS WKWebView continuously queries characterIndexForPoint via
// NSTextInputClient during xterm selection drag, triggering
// LocalFrame::rangeForPoint -> ICU cluster analysis, pegging the main thread.
//
// Fix: disable textarea during drag — NSTextInputContext without a focusable
// text input does not query, breaking the hit-test storm at the source.
// Enable + refocus on release; normal / IME input proceeds as usual.
// Community precedent: xterm.js Discussion #5227.
//
// History:
// - Once used inert on sibling subtrees outside the terminal (attempted to
//   block NSTextInput hit-test traversal). 2026-05-25 sample proved inert only
//   changes interaction semantics, not RenderText presence in layout tree;
//   hit-test still traverses. Removed.
// - Once used textarea.blur(). 2026-05-27 user A/B testing showed Chinese IME
//   lag / English smooth, confirming the IME path is the true cause; blur
//   leaves textarea still focusable (may be reclaimed by RAF / internal
//   callbacks). Switched to disabled for hard disable, more thorough.
// - Once layered user-select:none suppression + window.getSelection()
//   .removeAllRanges() + TERMINAL_SELECTION_ACTIVE_EVENT broadcast to
//   RunningView/useUsageSnapshot to pause IPC polling. 2026-05-27 disabled
//   upgrade verified Chinese IME smooth; all side defenses removed.
export function attachMacWebKitTerminalGuard({
  term,
  container,
  writer,
}: TerminalSelectionGuardOptions): () => void {
  if (!IS_MAC_WEBKIT) return () => {};

  setMacWebKitTextareaAttrs(term);

  let pointerSelecting = false;
  let terminalHasSelection = term.hasSelection();

  // During drag selection, use disabled to cut off IME host:
  // - blur: textarea still focusable, subsequent RAF / internal callbacks may
  //   reclaim focus, IME can still query
  // - disabled: hard disable receiving focus / input, IME 100% cannot initiate
  //   NSTextInputClient queries
  // Reference: xterm.js Discussion #5227 (community battle-tested).
  const disableTextarea = () => {
    if (term.textarea && !term.textarea.disabled) {
      term.textarea.disabled = true;
    }
  };

  const enableTextarea = () => {
    if (term.textarea && term.textarea.disabled) {
      term.textarea.disabled = false;
    }
  };

  const refocusTextarea = () => {
    if (term.textarea) {
      term.textarea.focus({ preventScroll: true });
    }
  };

  const syncSelectionGuard = () => {
    if (pointerSelecting) disableTextarea();
    else enableTextarea();
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerSelecting = true;
    writer?.setSelectionPaused(true);
    syncSelectionGuard();
  };

  const handlePointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    // document-level listener: must first confirm this is a terminal-initiated
    // drag flow, otherwise we'd steal focus from other input fields.
    if (!pointerSelecting) return;
    pointerSelecting = false;
    writer?.setSelectionPaused(false);
    terminalHasSelection = term.hasSelection();
    syncSelectionGuard();
    refocusTextarea();
  };

  const handlePointerCancel = () => {
    if (!pointerSelecting) return;
    pointerSelecting = false;
    writer?.setSelectionPaused(false);
    terminalHasSelection = term.hasSelection();
    syncSelectionGuard();
    refocusTextarea();
  };

  const handleDocumentPointerDown = (e: PointerEvent) => {
    const target = e.target;
    if (
      !terminalHasSelection ||
      (target instanceof Node && container.contains(target))
    )
      return;
    pointerSelecting = false;
    terminalHasSelection = false;
    writer?.setSelectionPaused(false);
    term.clearSelection();
    syncSelectionGuard();
    // User clicked outside the terminal; focus naturally goes there, don't
    // forcibly reclaim textarea.
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !terminalHasSelection) return;
    pointerSelecting = false;
    terminalHasSelection = false;
    writer?.setSelectionPaused(false);
    term.clearSelection();
    syncSelectionGuard();
    refocusTextarea();
  };

  const selectionDisposable = term.onSelectionChange(() => {
    terminalHasSelection = term.hasSelection();
    syncSelectionGuard();
  });

  container.addEventListener("pointerdown", handlePointerDown);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerCancel);
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);
  document.addEventListener("keydown", handleKeyDown, true);

  return () => {
    selectionDisposable.dispose();
    container.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("pointerup", handlePointerUp);
    document.removeEventListener("pointercancel", handlePointerCancel);
    document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    // Fallback: if still in selection drag state at unmount, restore textarea
    // to avoid losing next input.
    enableTextarea();
    writer?.setSelectionPaused(false);
  };
}

/**
 * Create a watermark-based flow-control writer.
 *
 * - Pauses writing when xterm write queue exceeds HIGH_WATER
 * - Resumes below LOW_WATER
 * - selectionPaused pauses writing during mouse selection (optional use)
 */
export function createSmartWriter(term: Terminal): SmartWriter {
  const state = {
    pendingChunks: [] as Array<{ data: string; callback?: () => void }>,
    watermark: 0,
    paused: false,
    selectionPaused: false,
  };

  function flushOne(data: string, callback?: () => void) {
    state.watermark += data.length;
    term.write(data, () => {
      state.watermark -= data.length;
      callback?.();
      if (state.paused && state.watermark < LOW_WATER) {
        state.paused = false;
        drainPending();
      }
    });
  }

  function drainPending() {
    while (
      state.pendingChunks.length > 0 &&
      !state.paused &&
      !state.selectionPaused
    ) {
      const next = state.pendingChunks.shift()!;
      if (state.watermark >= HIGH_WATER) {
        state.pendingChunks.unshift(next);
        state.paused = true;
        break;
      }
      flushOne(next.data, next.callback);
    }
  }

  function write(data: string, callback?: () => void) {
    if (
      state.paused ||
      state.selectionPaused ||
      state.watermark >= HIGH_WATER
    ) {
      if (state.watermark >= HIGH_WATER) state.paused = true;
      state.pendingChunks.push({ data, callback });
      return;
    }
    flushOne(data, callback);
  }

  function setSelectionPaused(paused: boolean) {
    state.selectionPaused = paused;
    if (!paused) drainPending();
  }

  return { write, drainPending, setSelectionPaused };
}

// ── xterm initialization ─────────────────────────────────────────────────────

export interface InitTerminalResult {
  term: Terminal;
  fitAddon: FitAddon;
  /** Resolves when font is ready (1s timeout fallback), never rejects. On ready,
   *  fontFamily is toggled to trigger xterm cell remeasure; callers should
   *  safeFit once more after this. */
  whenFontsReady: Promise<void>;
}

const fontReadyCache = new Set<string>();
const FONT_READY_TIMEOUT_MS = 1000;
const TEXTURE_ATLAS_REFRESH_DELAYS_MS = [0, 50, 250, 1000, 2500, 5000] as const;

function primaryFontFamily(fontFamily: string): string | null {
  const first = fontFamily
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (!first) return null;
  if (
    first === "monospace" ||
    first === "serif" ||
    first === "sans-serif" ||
    first === "system-ui"
  ) {
    return null;
  }
  return first;
}

function waitForFontReady(
  fontFamily: string,
  fontSize: number,
): Promise<void> {
  const key = `${fontFamily}|${fontSize}`;
  if (fontReadyCache.has(key)) return Promise.resolve();

  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) {
    fontReadyCache.add(key);
    return Promise.resolve();
  }

  const primary = primaryFontFamily(fontFamily);
  const spec = primary ? `${fontSize}px "${primary}"` : null;

  // nezha uses system fonts only; fonts.load does not trigger network downloads —
  // only rejects on spec parse failure (developer concatenation bug), which we warn.
  const load = spec
    ? fonts.load(spec).catch((err) => {
        console.warn(`[terminal] invalid font spec "${spec}"`, err);
      })
    : Promise.resolve();

  const ready = load.then(() => fonts.ready).then(() => {});

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      fontReadyCache.add(key);
      resolve();
    };
    ready.then(finish).catch(finish);
    setTimeout(finish, FONT_READY_TIMEOUT_MS);
  });
}

function whenFontEventuallyReady(
  fontFamily: string,
  fontSize: number,
): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return Promise.resolve();

  const primary = primaryFontFamily(fontFamily);
  const spec = primary ? `${fontSize}px "${primary}"` : null;
  const load = spec
    ? fonts.load(spec).catch((err) => {
        console.warn(`[terminal] invalid font spec "${spec}"`, err);
      })
    : Promise.resolve();
  return load.then(() => fonts.ready).then(() => {});
}

const DOM_MEASURE_REPEAT = 32;
const domCellWidthCache = new Map<string, number>();

function isFontLoaded(fontFamily: string, fontSize: number): boolean {
  const primary = primaryFontFamily(fontFamily);
  if (!primary) return true; // Generic keywords (monospace etc.) are always ready.
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts) return true;
  try {
    return fonts.check(`${fontSize}px "${primary}"`);
  } catch {
    return true;
  }
}

function measureCellWidthInDOM(
  fontFamily: string,
  fontSize: number,
): number | null {
  if (typeof document === "undefined" || !document.body) return null;
  const key = `${fontFamily}|${fontSize}`;
  const cached = domCellWidthCache.get(key);
  if (cached !== undefined) return cached;

  const probe = document.createElement("span");
  probe.classList.add("xterm-char-measure-element");
  probe.setAttribute("aria-hidden", "true");
  probe.style.whiteSpace = "pre";
  probe.style.fontKerning = "none";
  probe.style.fontFamily = fontFamily;
  probe.style.fontSize = `${fontSize}px`;
  // Match xterm's DomMeasureStrategy: 32 W characters average out layout rounding errors.
  probe.textContent = "W".repeat(DOM_MEASURE_REPEAT);
  document.body.appendChild(probe);
  try {
    const width = probe.offsetWidth / DOM_MEASURE_REPEAT;
    if (!Number.isFinite(width) || width <= 0) return null;
    // Font not ready → measured fallback width; do not cache. Ready → cache.
    if (isFontLoaded(fontFamily, fontSize)) {
      domCellWidthCache.set(key, width);
    }
    return width;
  } finally {
    probe.remove();
  }
}

/**
 * Only override the width in xterm's measurement result, without directly
 * writing `_charSizeService`'s current values.
 *
 * WKWebView/OffscreenCanvas may measure half-width CJK Nerd Font characters
 * as fullwidth via measureText. Here we use DOM width to shadow the strategy's
 * return value, letting xterm's own measure() continue to write width/height,
 * fire onCharSizeChange, and update the renderer. Height stays as xterm's
 * original result, avoiding DOM height semantics + xterm lineHeight stacking
 * from pulling the entire screen's cell dimensions out of whack.
 */
export function applyDomCharSizeOverride(term: Terminal): () => void {
  const core = (term as XTermWithPrivates)._core;
  const charSizeService = core?._charSizeService;
  const strategy = charSizeService?._measureStrategy;
  if (
    !charSizeService ||
    !strategy ||
    typeof strategy.measure !== "function"
  ) {
    console.warn(
      "[terminal] xterm char size strategy inaccessible; skip DOM width override",
    );
    return () => {};
  }

  const original = strategy.measure.bind(strategy);
  let active = true;
  let warnedMismatch = false;

  strategy.measure = () => {
    const result = original();
    if (!active || result.width <= 0 || result.height <= 0) return result;

    const fontFamily = term.options.fontFamily;
    const fontSize = term.options.fontSize;
    if (typeof fontFamily !== "string" || typeof fontSize !== "number")
      return result;

    const domWidth = measureCellWidthInDOM(fontFamily, fontSize);
    if (domWidth === null || Math.abs(result.width - domWidth) < 0.5)
      return result;

    if (!warnedMismatch) {
      warnedMismatch = true;
      console.warn(
        `[terminal] xterm measured cell width=${result.width.toFixed(2)}, DOM width=${domWidth.toFixed(2)}; using DOM width`,
      );
    }
    return { width: domWidth, height: result.height };
  };

  try {
    charSizeService.measure();
  } catch {
    /* term not fully ready — ignore; font/size changes will trigger measure again */
  }

  return () => {
    active = false;
    strategy.measure = original;
  };
}

// xterm OptionsService dirty-checks same-value fontFamily and skips; use toggle
// to bypass.
function refreshCharSizeAfterFontReady(
  term: Terminal,
  fontFamily: string,
): void {
  try {
    if (term.options.fontFamily !== fontFamily) return;
    term.options.fontFamily = `${fontFamily}, monospace`;
    term.options.fontFamily = fontFamily;
  } catch {
    /* normal race: term already disposed */
  }
}

export function initTerminal(
  variant: ThemeVariant,
  scrollback = 1000,
  fontSize = 12,
  fontFamily = "monospace",
): InitTerminalResult {
  const term = new Terminal({
    convertEol: false,
    scrollback,
    cursorBlink: true,
    fontFamily,
    fontSize,
    theme: themeFor(variant),
    minimumContrastRatio: minimumContrastRatioFor(variant),
    allowProposedApi: true,
     // overviewRuler removed — not in current xterm typings
    // When running TUIs (Claude Code / Codex) with mouse reporting enabled, xterm
    // defaults to forwarding drag as mouse events and canceling local selection,
    // preventing macOS users from "selecting during runtime". This flag enables
    // holding Option to force local selection (standard iTerm2 / Terminal.app convention).
    macOptionClickForcesSelection: true,
  });

  const fitAddon = new FitAddon();
  const unicode11Addon = new Unicode11Addon();
  term.loadAddon(fitAddon);
  term.loadAddon(unicode11Addon);
  term.unicode.activeVersion = "11";

  const whenFontsReady = waitForFontReady(fontFamily, fontSize).then(() => {
    refreshCharSizeAfterFontReady(term, fontFamily);
  });

  return { term, fitAddon, whenFontsReady };
}

export function attachTerminalScrollbarAutoHide(
  term: Terminal,
  container: HTMLElement,
): () => void {
  const ownerWindow = container.ownerDocument.defaultView ?? window;
  let scrollHideTimer: number | null = null;

  const clearScrollHideTimer = () => {
    if (scrollHideTimer === null) return;
    ownerWindow.clearTimeout(scrollHideTimer);
    scrollHideTimer = null;
  };

  const hideAfterScroll = () => {
    clearScrollHideTimer();
    scrollHideTimer = ownerWindow.setTimeout(() => {
      container.classList.remove("nezha-xterm-scrolling");
      scrollHideTimer = null;
    }, 700);
  };

  const handleScroll = () => {
    container.classList.add("nezha-xterm-scrolling");
    hideAfterScroll();
  };

  const scrollDisposable = term.onScroll(handleScroll);

  return () => {
    clearScrollHideTimer();
    container.classList.remove("nezha-xterm-scrolling");
    scrollDisposable.dispose();
  };
}

export interface WebglAddonHandle {
  /** Release the WebGL addon. Safe to call even if async load hasn't completed;
   *  marks disposed to block subsequent load. */
  dispose: () => void;
}

interface TextureAtlasRefreshState {
  generation: number;
  frameIds: number[];
  timerIds: number[];
}

const textureAtlasRefreshState = new WeakMap<
  Terminal,
  TextureAtlasRefreshState
>();

function getTerminalOwnerWindow(term: Terminal): Window {
  return term.element?.ownerDocument.defaultView ?? window;
}

function getTextureAtlasRefreshState(
  term: Terminal,
): TextureAtlasRefreshState {
  let state = textureAtlasRefreshState.get(term);
  if (!state) {
    state = { generation: 0, frameIds: [], timerIds: [] };
    textureAtlasRefreshState.set(term, state);
  }
  return state;
}

function cancelScheduledTextureAtlasRefresh(
  term: Terminal,
): TextureAtlasRefreshState {
  const ownerWindow = getTerminalOwnerWindow(term);
  const state = getTextureAtlasRefreshState(term);
  for (const frameId of state.frameIds) {
    ownerWindow.cancelAnimationFrame(frameId);
  }
  for (const timerId of state.timerIds) {
    ownerWindow.clearTimeout(timerId);
  }
  state.frameIds = [];
  state.timerIds = [];
  return state;
}

/**
 * After font or font-size change, discard the WebGL atlas so new-size glyphs
 * are re-rasterized. Silently ignored when WebGL unavailable (clearTextureAtlas
 * missing / throws).
 */
function refreshTextureAtlas(term: Terminal): void {
  try {
    term.clearTextureAtlas();
    if (term.rows > 0) {
      term.refresh(0, term.rows - 1);
    }
  } catch {
    /* DOM renderer has no atlas / term disposed */
  }
}

function scheduleTextureAtlasRefresh(term: Terminal): void {
  const ownerWindow = getTerminalOwnerWindow(term);
  const state = cancelScheduledTextureAtlasRefresh(term);
  const generation = state.generation + 1;
  state.generation = generation;

  const firstFrame = ownerWindow.requestAnimationFrame(() => {
    if (state.generation !== generation || !term.element) return;
    const secondFrame = ownerWindow.requestAnimationFrame(() => {
      if (state.generation !== generation || !term.element) return;
      for (const delay of TEXTURE_ATLAS_REFRESH_DELAYS_MS) {
        const timerId = ownerWindow.setTimeout(() => {
          if (state.generation !== generation || !term.element) return;
          refreshTextureAtlas(term);
        }, delay);
        state.timerIds.push(timerId);
      }
    });
    state.frameIds.push(secondFrame);
  });
  state.frameIds.push(firstFrame);
}

/**
 * `display:none -> re-visible` path: xterm WebGL canvas may enter corrupted
 * atlas/render state while removed from layout tree (visual garbage visible on
 * returning to the project; resizing fixes it). Wait one frame for layout to
 * settle, then clear the cache once.
 *
 * Does NOT reuse scheduleTextureAtlasRefresh — that one schedules 6 delayed
 * nodes as font async-load fallback; fonts are already ready on return,
 * running 6 times would produce 6 visible flashes.
 */
export function refreshTerminalDisplay(term: Terminal): void {
  const ownerWindow = getTerminalOwnerWindow(term);
  const state = cancelScheduledTextureAtlasRefresh(term);
  const generation = state.generation + 1;
  state.generation = generation;
  const frameId = ownerWindow.requestAnimationFrame(() => {
    if (state.generation !== generation || !term.element) return;
    refreshTextureAtlas(term);
  });
  state.frameIds.push(frameId);
}

/**
 * Async-load WebGL addon: wait for font ready before constructing, so the
 * atlas doesn't prefill with fallback font for the first fill. Silently
 * degrades to xterm DOM renderer on failure.
 *
 * Why font-ready is required: WebGL renderer caches rasterized results in a
 * glyph atlas — whatever font fills it first is what subsequent cells render
 * with. If the atlas is filled with unloaded fallback font, characters will
 * display as fallback shapes even after cell dimensions are corrected.
 *
 * On "should we disable WebGL" — measured conclusions (recording8/9/10 comparison):
 * - WebGL cost: occasional 100-400ms composite spikes during large selection drag
 *   (GPU geometry upload)
 * - DOM renderer cost: sustained medium jank during high-frequency mousemove
 *   (mouse in terminal area) + high-speed text output (each mousemove triggers
 *   multiple row DOM node reflows/composites; rec10 measured 511ms single frame
 *   over 1233 mousemoves in 2.7s)
 * - Nezha's typical usage is "mouse active in terminal area"; long drag selections
 *   are relatively rare. Therefore WebGL's "occasional spike" is more acceptable
 *   than DOM's "sustained micro-jank".
 *
 * Do not disable WebGL here to "avoid occasional jank" — see timeline rec10.
 *
 * Must be called after `term.open()` — term.element is only attached at open time.
 */
export function loadWebglAddon(term: Terminal): WebglAddonHandle {
  let disposed = false;
  let addon: WebglAddon | null = null;

  const fontFamily =
    typeof term.options.fontFamily === "string"
      ? term.options.fontFamily
      : "monospace";
  const fontSize =
    typeof term.options.fontSize === "number" ? term.options.fontSize : 12;

  void waitForFontReady(fontFamily, fontSize).finally(() => {
    if (disposed || !term.element) return;
    refreshCharSizeAfterFontReady(term, fontFamily);
    try {
      addon = new WebglAddon();
      addon.onContextLoss(() => {
        console.warn(
          "[terminal] WebGL context lost; falling back to xterm DOM renderer",
        );
        addon?.dispose();
        addon = null;
      });
      term.loadAddon(addon);
      scheduleTextureAtlasRefresh(term);
      void whenFontEventuallyReady(fontFamily, fontSize).then(() => {
        if (!disposed && term.element) {
          refreshCharSizeAfterFontReady(term, fontFamily);
          scheduleTextureAtlasRefresh(term);
        }
      });
    } catch (err) {
      console.warn(
        "[terminal] WebGL addon unavailable; using xterm DOM renderer",
        err,
      );
      /* WebGL unsupported — degrade gracefully, no functional impact */
    }
  });

  return {
    dispose: () => {
      disposed = true;
      cancelScheduledTextureAtlasRefresh(term);
      addon?.dispose();
      addon = null;
    },
  };
}

/**
 * Safely execute fitAddon.fit() and return { cols, rows }; returns null on
 * failure / invisible container.
 *
 * When container is provided, two extra defenses are applied (known issues
 * from xterm.js #3029 / #4338 / #4841):
 * 1. rect width/height either 0 → container in display:none subtree, skip.
 *    This is the normal state for inactive ProjectPage during multi-project mount.
 * 2. proposeDimensions returns non-finite values or cols/rows < 2 → degenerate, skip.
 *
 * Why these must be blocked: FitAddon on a 0-size container doesn't return NaN,
 * but degrades to `Math.max(MINIMUM_COLS, Math.floor(0 / cell))` = MINIMUM_COLS (2).
 * If allowed through → caller notifyResize → resize_pty → SIGWINCH → Claude Code /
 * Codex TUIs re-layout at cols=2, permanently shredding the buffer into one-character
 * lines. VS Code's equivalent defense in _resize() checks `if (isNaN(cols) ||
 * isNaN(rows)) return`, but xterm.js's NaN path doesn't exist; we must block at
 * the rect level first.
 */
export function safeFit(
  fitAddon: FitAddon,
  term: Terminal,
  container?: HTMLElement,
): { cols: number; rows: number } | null {
  if (container) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
  }
  try {
    const dims = fitAddon.proposeDimensions();
    if (
      !dims ||
      !Number.isFinite(dims.cols) ||
      !Number.isFinite(dims.rows)
    )
      return null;
    if (dims.cols < 2 || dims.rows < 2) return null;
    fitAddon.fit();
    return { cols: term.cols, rows: term.rows };
  } catch {
    return null;
  }
}

/**
 * Update terminal font size and re-fit, returning new { cols, rows } or null.
 */
export function applyTerminalFontSize(
  term: Terminal,
  fitAddon: FitAddon,
  fontSize: number,
  container?: HTMLElement,
): { cols: number; rows: number } | null {
  if (term.options.fontSize === fontSize) return null;
  term.options.fontSize = fontSize;
  const result = safeFit(fitAddon, term, container);
  scheduleTextureAtlasRefresh(term);
  return result;
}

export interface FontFamilyApplyResult {
  /** Synchronous fit result. When the new font hasn't loaded yet, this is the
   *  fallback font's dimensions — fed to the user immediately. */
  immediate: { cols: number; rows: number } | null;
  /** After font ready, remeasure and fit. CJK monospace fonts need this step
   *  on first load to correct cols/rows. */
  whenSettled: Promise<{ cols: number; rows: number } | null>;
}

export function applyTerminalFontFamily(
  term: Terminal,
  fitAddon: FitAddon,
  fontFamily: string,
  container?: HTMLElement,
): FontFamilyApplyResult | null {
  if (term.options.fontFamily === fontFamily) return null;
  term.options.fontFamily = fontFamily;
  const fontSize =
    typeof term.options.fontSize === "number" ? term.options.fontSize : 12;
  const immediate = safeFit(fitAddon, term, container);
  const whenSettled = waitForFontReady(fontFamily, fontSize).then(() => {
    refreshCharSizeAfterFontReady(term, fontFamily);
    scheduleTextureAtlasRefresh(term);
    return safeFit(fitAddon, term, container);
  });
  return { immediate, whenSettled };
}
