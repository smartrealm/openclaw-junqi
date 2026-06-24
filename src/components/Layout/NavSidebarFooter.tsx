// ── NavSidebarFooter — sidebar bottom bar ─────────────────────────────────
//
// Compact row: Theme cycle | Usage | Settings — all in one place.

import { Moon, Sun, Settings, Palette } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyTheme } from '@/theme/apply';
import { UsagePopover } from '@/components/shared/UsagePopover';
import type { AegisTheme } from '@/theme/types';

const THEME_CYCLE: AegisTheme[] = ['aegis-dark', 'aegis-light', 'aegis-eyecare', 'aegis-midnight'];

const THEME_I18N_KEYS: Record<AegisTheme, string> = {
  'aegis-dark': 'theme.dark',
  'aegis-light': 'theme.light',
  'aegis-eyecare': 'theme.eyecare',
  'aegis-midnight': 'theme.midnight',
};

function nextTheme(current: AegisTheme): AegisTheme {
  const idx = THEME_CYCLE.indexOf(current);
  if (idx < 0) return 'aegis-dark';
  return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
}

export function NavSidebarFooter({ collapsed }: { collapsed?: boolean }) {
  const { t } = useTranslation();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const resolvedCurrent: AegisTheme = theme.startsWith('aegis-') ? (theme as AegisTheme) : 'aegis-dark';
  const isDarkish = resolvedCurrent === 'aegis-dark' || resolvedCurrent === 'aegis-midnight';
  const label = t(THEME_I18N_KEYS[resolvedCurrent], resolvedCurrent.replace('aegis-', ''));

  const handleCycle = () => {
    const next = nextTheme(resolvedCurrent);
    // Apply CSS first (DOM-only, no React re-render) so the visual
    // swap completes before React components re-render with new tokens.
    // This prevents the brief "old colors then new colors" flash.
    applyTheme(next);
    setTheme(next);
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 pb-2">
        <button type="button" onClick={handleCycle}
          title={label} aria-label={t('theme.cycle', 'Cycle theme')}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
          {isDarkish ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <UsagePopover />
        <NavLink to="/settings" title={t('nav.settings', 'Settings')} aria-label={t('nav.settings', 'Settings')}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
          <Settings size={14} />
        </NavLink>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 mx-2 mb-2 rounded-lg"
      style={{ background: 'rgb(var(--aegis-overlay) / 0.03)', border: '1px solid rgb(var(--aegis-border))' }}>
      <Palette size={12} className="ml-0.5 text-aegis-text-dim shrink-0" />
      <button type="button" onClick={handleCycle}
        title={label}
        className="flex-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors text-start truncate text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
        {label}
      </button>
      <UsagePopover />
      <NavLink to="/settings" title={t('nav.settings', 'Settings')}
        className="px-1 py-1 rounded transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
        <Settings size={13} />
      </NavLink>
    </div>
  );
}
