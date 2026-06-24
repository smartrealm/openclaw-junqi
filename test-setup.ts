// ── test-setup.ts ────────────────────────────────────────────────────────────
// Loaded before every frontend test file via `node --import`.
//
// Sets up globals that Vite normally injects at build time, so tests that
// import modules transitively pulling in these globals don't fail with
// ReferenceError. Each global uses a sensible test default.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Vite injects these from vite.config.ts. Mirror them here so module-level
// reads (e.g. `const X = __APP_VERSION__`) don't crash.
const pkg = await import(resolve(here, 'package.json'), {
  with: { type: 'json' },
}).then((m) => m.default);

globalThis.__APP_VERSION__ = pkg.version ?? 'test';

// Minimal `localStorage` shim. jsdom / happy-dom aren't installed and we
// want zero extra deps. i18n.ts reads it at module-load time.
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
  key: (i) => Array.from(storage.keys())[i] ?? null,
  get length() {
    return storage.size;
  },
};

// `matchMedia` is referenced by some UI libs (lucide-react animations,
// radix-ui primitives). Stub to "no-preference" so they don't crash.
if (typeof globalThis.matchMedia !== 'function') {
  globalThis.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Minimal `window` shim for code that reads `window.aegis` (Tauri
// exposes window.aegis as a runtime API bridge in the real browser).
// Use defineProperty to avoid "only has a getter" errors on Node 25.
if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
}
if (!('document' in globalThis)) {
  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement: { dir: 'ltr' },
      hasFocus: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    writable: true,
    configurable: true,
  });
}
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node-test' },
    writable: true,
    configurable: true,
  });
}
