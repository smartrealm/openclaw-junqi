import type { CSSProperties } from 'react';

/** Solid, theme-aware surface shared by terminal context menus. */
export const TERMINAL_CONTEXT_MENU_STYLE: Readonly<CSSProperties> = Object.freeze({
  background: 'var(--aegis-menu-bg)',
  border: '1px solid var(--aegis-menu-border)',
  boxShadow: 'var(--aegis-menu-shadow)',
  color: 'rgb(var(--aegis-menu-text))',
});
