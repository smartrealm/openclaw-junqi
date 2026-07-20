// ── Global error trap (must be FIRST) ──
// xtermSafePatch must install BEFORE the error handler so it can
// suppress harmless "dimensions" / "syncScrollArea" errors before
// they hit the showError trap (which replaces the entire app DOM).
import { installXtermSafePatch } from './components/Terminal/xtermSafePatch';
installXtermSafePatch();

function showError(title: string, detail: string) {
  document.getElementById('app-root')!.innerHTML =
    `<div style="display:flex;flex-direction:column;height:100vh;align-items:center;justify-content:center;background:#0c1015;color:white;font-family:monospace;gap:8px;padding:20px">` +
    `<h2 style="color:#ef4444">${title}</h2>` +
    `<pre style="color:#f87171;font-size:11px;max-width:600px;white-space:pre-wrap">${detail}</pre>` +
    `</div>`;
}

function isBenignResizeObserverError(message: unknown): boolean {
  const text = String(message ?? '');
  return text === 'ResizeObserver loop completed with undelivered notifications.'
    || text === 'ResizeObserver loop limit exceeded';
}

window.addEventListener('error', (e) => {
  if (isBenignResizeObserverError(e.message)) {
    e.preventDefault();
    return;
  }
  showError('JS Error', e.error?.stack || e.message);
});
window.addEventListener('unhandledrejection', (e) => showError('Promise Rejection', e.reason || String(e.reason)));

// Apply the saved theme SYNCHRONOUSLY before any render so chrome-bg / glass-bg
// resolve the right --aegis-* variables on the very first paint (no dark→light
// flicker on launch, no wrong "always dark" chrome).
//
// CRITICAL: the theme CSS files key exclusively on `[data-theme="..."]`
// — without an attribute on <html>, NO theme matches and the app paints
// unstyled. earlyBootstrap() guarantees the attribute is set before the
// stylesheet imports below resolve.
import { earlyBootstrap } from './theme/earlyBootstrap';
earlyBootstrap();

// Detect host OS and stamp <html> + <body> with data-tauri-platform.
// Used by CSS to scope -webkit-font-smoothing and font-feature-settings.
// <html> is stamped synchronously (always exists); <body> is stamped
// after DOMContentLoaded so CSS body selectors also match.
(function stampPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  const p = ua.includes('win') ? 'windows'
          : ua.includes('mac') ? 'macos'
          : 'linux';
  // <html> is always present at module-eval time
  document.documentElement.setAttribute('data-tauri-platform', p);
  document.documentElement.setAttribute('data-platform', p);
  // <body> may not exist yet — defer with a guaranteed-fast callback
  const stamp = () => {
    document.body?.setAttribute('data-tauri-platform', p);
    document.body?.setAttribute('data-platform', p);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stamp, { once: true });
  } else {
    stamp();
  }
})();

(async function boot() {
  await import('./api/tauri-adapter');
  await import('./i18n');
  await import('@/styles/index.css');
  const [React, ReactDOM, ErrorBoundary] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@/components/shared/ErrorBoundary'),
  ]);

  // Auxiliary windows share the SPA entry but use deliberately lightweight
  // roots. Only the main window owns Gateway process lifecycle management.
  let windowLabel = '';
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    windowLabel = getCurrentWindow().label;
  } catch {
    /* plain vite/browser context */
  }
  if (windowLabel.startsWith('terminal-')) {
    (window as Window & { __JUNQI_TERMINAL_WINDOW_LABEL__?: string })
      .__JUNQI_TERMINAL_WINDOW_LABEL__ = windowLabel;
  }
  const Root =
    windowLabel === 'pet'
      ? (await import('./pet/PetWindow')).default
      : windowLabel === 'dynamic-island'
        ? (await import('./dynamic-island/DynamicIsland')).default
        : windowLabel === 'quickchat'
          ? (await import('./pages/QuickChatRoot')).default
          : windowLabel.startsWith('terminal-')
            ? (await import('./pages/TerminalWindowRoot')).default
            : (await import('./App')).default;

  ReactDOM.createRoot(document.getElementById('app-root')!).render(
    React.createElement(React.StrictMode, null,
      React.createElement(ErrorBoundary.ErrorBoundary, null,
        React.createElement(Root)
      )
    )
  );
})().catch((e: any) => showError('Boot Error', e?.stack || e?.message || String(e)));
