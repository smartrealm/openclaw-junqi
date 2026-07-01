// ── NavSidebarFooter — sidebar bottom bar ─────────────────────────────────
//
// Compact row: Theme cycle | Usage | Settings — all in one place.

import { Moon, Sun, Settings, Palette, PawPrint, Timer, Play, Pause } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyTheme } from '@/theme/apply';
import { UsagePopover } from '@/components/shared/UsagePopover';
import { usePetStore } from '@/stores/petStore';
import { startPomodoro, togglePausePomodoro } from '@/pet/petActions';
import clsx from 'clsx';
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

  const petEnabled = usePetStore((s) => s.enabled);
  const setPetEnabled = usePetStore((s) => s.setEnabled);
  const pomoEnabled = usePetStore((s) => s.pomodoro.enabled);
  const pomoRunning = usePetStore((s) => s.pomodoro.running);
  const pomoPaused = usePetStore((s) => s.pomodoro.paused);
  const pomoPhase = usePetStore((s) => s.pomodoro.phase);
  const setPomodoro = usePetStore((s) => s.setPomodoro);

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
        <button type="button" onClick={() => setPetEnabled(!petEnabled)}
          title={petEnabled ? t('statusBar.petOnTip', '点击关闭桌面宠物') : t('statusBar.petOffTip', '点击开启桌面宠物')}
          className={clsx('w-7 h-7 flex items-center justify-center rounded-md transition-colors',
            petEnabled ? 'text-aegis-primary' : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]')}>
          <PawPrint size={14} />
        </button>
        {pomoEnabled ? (
          pomoRunning ? (
            <button type="button" onClick={togglePausePomodoro}
              title={pomoPaused ? t('statusBar.pomoResume', '继续') : t('statusBar.pomoPause', '暂停')}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-warning hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
              {pomoPaused ? <Play size={14} /> : <Pause size={14} />}
            </button>
          ) : (
            <button type="button" onClick={startPomodoro}
              title={t('statusBar.pomoStart', '开始番茄')}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
              <Timer size={14} />
            </button>
          )
        ) : (
          <button type="button" onClick={() => setPomodoro({ enabled: true })}
            title={t('statusBar.togglePomodoro', '开启番茄钟')}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
            <Timer size={14} />
          </button>
        )}
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
      <button type="button" onClick={() => setPetEnabled(!petEnabled)}
        title={petEnabled ? t('statusBar.petOnTip', '点击关闭桌面宠物') : t('statusBar.petOffTip', '点击开启桌面宠物')}
        className={clsx('px-1 py-1 rounded transition-colors', petEnabled ? 'text-aegis-primary' : 'text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]')}>
        <PawPrint size={13} />
      </button>
      {pomoEnabled ? (
        pomoRunning ? (
          <button type="button" onClick={togglePausePomodoro}
            title={pomoPaused ? t('statusBar.pomoResume', '继续') : t('statusBar.pomoPause', '暂停')}
            className="px-1 py-1 rounded transition-colors text-aegis-warning hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
            {pomoPaused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        ) : (
          <button type="button" onClick={startPomodoro}
            title={t('statusBar.pomoStart', '开始番茄')}
            className="px-1 py-1 rounded transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
            <Timer size={13} />
          </button>
        )
      ) : (
        <button type="button" onClick={() => setPomodoro({ enabled: true })}
          title={t('statusBar.togglePomodoro', '开启番茄钟')}
          className="px-1 py-1 rounded transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
          <Timer size={13} />
        </button>
      )}
      <UsagePopover />
      <NavLink to="/settings" title={t('nav.settings', 'Settings')}
        className="px-1 py-1 rounded transition-colors text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.08)]">
        <Settings size={13} />
      </NavLink>
    </div>
  );
}
