export const FATAL_ERROR_OVERLAY_ID = 'junqi-fatal-error-overlay';

const OVERLAY_STYLE = [
  'position:fixed',
  'inset:0',
  'z-index:2147483647',
  'display:flex',
  'flex-direction:column',
  'align-items:center',
  'justify-content:center',
  'gap:8px',
  'box-sizing:border-box',
  'padding:20px',
  'background:#0c1015',
  'color:white',
  'font-family:monospace',
].join(';');

/**
 * Presents a startup/runtime failure without taking ownership of React's root.
 *
 * Global browser errors can arrive while React is reconciling a portal. Writing
 * into #app-root in that window removes nodes React still owns, which turns the
 * original error into a removeChild DOMException during the next commit.
 */
export function showFatalErrorOverlay(
  title: unknown,
  detail: unknown,
  doc: Document = document,
): HTMLElement {
  let overlay = doc.getElementById(FATAL_ERROR_OVERLAY_ID);
  if (!overlay) {
    overlay = doc.createElement('section');
    overlay.id = FATAL_ERROR_OVERLAY_ID;
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'assertive');
    overlay.style.cssText = OVERLAY_STYLE;
    (doc.body ?? doc.documentElement).appendChild(overlay);
  }

  const heading = doc.createElement('h2');
  heading.style.cssText = 'margin:0;color:#ef4444;font-size:20px';
  heading.textContent = String(title ?? 'Unexpected error');

  const stack = doc.createElement('pre');
  stack.style.cssText = 'margin:0;color:#f87171;font-size:11px;max-width:600px;white-space:pre-wrap';
  stack.textContent = String(detail ?? '');

  overlay.replaceChildren(heading, stack);
  return overlay;
}
