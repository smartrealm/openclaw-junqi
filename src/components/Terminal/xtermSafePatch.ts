// ─────────────────────────────────────────────────────────────────
// xtermSafePatch — global monkey-patch to silence xterm.js internal
// "dimensions" / "syncScrollArea" errors when the container momentarily
// has zero size during React re-renders or flex layout changes.
//
// xterm.js scheduling (requestAnimationFrame inside _core._renderService
// and _core._inputHandler) can fire AFTER our dimension guards, when the
// React key swap briefly unmounts the old container. These are non-fatal
// — the terminal still renders fine once the new container is painted.
//
// Call `installXtermSafePatch()` once at app boot. Returns a disposer.
// ─────────────────────────────────────────────────────────────────

import { debugLog } from "@/utils/debugLog";

let installed = false;
let origHandler: ((event: ErrorEvent) => void) | null = null;

export function installXtermSafePatch(): () => void {
  if (installed) return () => {};
  installed = true;

  const SUPPRESS_PATTERNS = [
    /dimensions/i,
    /syncScrollArea/i,
  ];

  origHandler = (event: ErrorEvent) => {
    // Only suppress xterm-specific internal errors. Let everything
    // else through to the normal console / sentry handlers.
    const msg = event.message || '';
    const stack = (event.error as Error)?.stack || '';
    const combined = `${msg}\n${stack}`;

    const shouldSuppress = SUPPRESS_PATTERNS.some((re) => re.test(combined));
    if (shouldSuppress) {
      // Must stop *all* handlers — main.tsx installs a fatal error screen
      // on window.error that replaces the entire app with red text.
      event.preventDefault();
      event.stopImmediatePropagation();
      debugLog('terminal', '[xtermSafePatch] suppressed dimensions/syncScrollArea error');
      return;
    }
  };

  window.addEventListener('error', origHandler, true); // capture phase

  return () => {
    installed = false;
    if (origHandler) {
      window.removeEventListener('error', origHandler, true);
      origHandler = null;
    }
  };
}
