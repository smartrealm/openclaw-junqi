// ── Global error trap (must be FIRST) ──
function showError(title: string, detail: string) {
  document.getElementById('app-root')!.innerHTML =
    `<div style="display:flex;flex-direction:column;height:100vh;align-items:center;justify-content:center;background:#0c1015;color:white;font-family:monospace;gap:8px;padding:20px">` +
    `<h2 style="color:#ef4444">${title}</h2>` +
    `<pre style="color:#f87171;font-size:11px;max-width:600px;white-space:pre-wrap">${detail}</pre>` +
    `</div>`;
}
window.addEventListener('error', (e) => showError('JS Error', e.error?.stack || e.message));
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

(async function boot() {
  // Inter UI font (weights used across the app). Imported before index.css so
  // the --font-sans stack can resolve it on first paint.
  await import('@fontsource/inter/400.css');
  await import('@fontsource/inter/500.css');
  await import('@fontsource/inter/600.css');
  await import('@fontsource/inter/700.css');
  await import('./api/tauri-adapter');
  await import('./i18n');
  await import('@/styles/index.css');
  const [React, ReactDOM, ErrorBoundary] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('@/components/shared/ErrorBoundary'),
  ]);

  // The "pet" window is a lightweight companion: it shares this SPA entry but
  // renders a different root — it must NOT mount the full app / gateway client.
  let windowLabel = '';
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    windowLabel = getCurrentWindow().label;
      } catch {
    /* plain vite/browser context */
  }
  const Root =
    windowLabel === 'pet'
      ? (await import('./pet/PetWindow')).default
      : (await import('./App')).default;

  ReactDOM.createRoot(document.getElementById('app-root')!).render(
    React.createElement(React.StrictMode, null,
      React.createElement(ErrorBoundary.ErrorBoundary, null,
        React.createElement(Root)
      )
    )
  );
})().catch((e: any) => showError('Boot Error', e?.stack || e?.message || String(e)));
