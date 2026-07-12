/** Build-time desktop version injected by Vite from package.json. */
export const APP_VERSION = typeof __APP_VERSION__ === 'string' && __APP_VERSION__
  ? __APP_VERSION__
  : 'dev';
