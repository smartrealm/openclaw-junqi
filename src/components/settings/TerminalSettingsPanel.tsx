import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Loader2, Minus, Plus, RotateCcw, TerminalSquare } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { GlassCard } from '@/components/shared/GlassCard';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  DEFAULT_TERMINAL_SCROLLBACK,
  DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE,
  TERMINAL_SETTINGS_CHANGED_EVENT,
  useTerminalPreferences,
} from '@/hooks/useTerminalPreferences';

const SCROLLBACK_OPTIONS = [500, 1000, 2000, 3000, 5000] as const;
const MONO_FONT_OPTIONS = ['', 'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Fira Code', 'IBM Plex Mono'] as const;

type SaveState = 'idle' | 'saving' | 'saved';

function PreferenceSwitch({ checked, disabled, label, onChange }: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-aegis-primary/55 bg-aegis-primary/35' : 'border-aegis-border bg-aegis-input',
      )}
    >
      <span className={clsx(
        'absolute start-0.5 top-0.5 h-[18px] w-[18px] rounded-full transition-transform',
        checked ? 'translate-x-[21px] bg-aegis-primary rtl:-translate-x-[21px]' : 'translate-x-0 bg-aegis-text-dim',
      )} />
    </button>
  );
}

export function TerminalSettingsPanel() {
  const { t } = useTranslation();
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const monoFont = useSettingsStore((state) => state.monoFont);
  const setMonoFont = useSettingsStore((state) => state.setMonoFont);
  const preferences = useTerminalPreferences();
  const [shiftEnterNewline, setShiftEnterNewline] = useState(DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setShiftEnterNewline(preferences.shiftEnterNewline), [preferences.shiftEnterNewline]);

  const fontOptions = useMemo(() => {
    const current = monoFont.replace(/^['"]|['"],\s*(?:monospace|sans-serif)$/g, '');
    return current && !MONO_FONT_OPTIONS.includes(current as typeof MONO_FONT_OPTIONS[number])
      ? [...MONO_FONT_OPTIONS, current]
      : [...MONO_FONT_OPTIONS];
  }, [monoFont]);

  const showSaved = () => {
    setSaveState('saved');
    window.setTimeout(() => setSaveState('idle'), 1400);
  };

  const saveScrollback = async (scrollback: number) => {
    setSaveState('saving');
    setError(null);
    try {
      await invoke('save_terminal_scrollback', { scrollback });
      window.dispatchEvent(new Event(TERMINAL_SETTINGS_CHANGED_EVENT));
      showSaved();
    } catch (reason) {
      setSaveState('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const saveShiftEnter = async (next: boolean) => {
    const previous = shiftEnterNewline;
    setShiftEnterNewline(next);
    setSaveState('saving');
    setError(null);
    try {
      await invoke('save_terminal_shift_enter_newline', { enabled: next });
      window.dispatchEvent(new Event(TERMINAL_SETTINGS_CHANGED_EVENT));
      showSaved();
    } catch (reason) {
      setShiftEnterNewline(previous);
      setSaveState('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const resetDefaults = async () => {
    setTerminalFontSize(12);
    setMonoFont('');
    setShiftEnterNewline(DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
    setSaveState('saving');
    setError(null);
    try {
      await Promise.all([
        invoke('save_terminal_scrollback', { scrollback: DEFAULT_TERMINAL_SCROLLBACK }),
        invoke('save_terminal_shift_enter_newline', { enabled: DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE }),
      ]);
      window.dispatchEvent(new Event(TERMINAL_SETTINGS_CHANGED_EVENT));
      showSaved();
    } catch (reason) {
      setSaveState('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section aria-labelledby="terminal-settings-title" className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="terminal-settings-title" className="flex items-center gap-2 text-[16px] font-semibold text-aegis-text">
            <TerminalSquare size={17} className="text-aegis-primary" />
            {t('terminalSettings.title', '终端设置')}
          </h2>
          <p className="mt-1 text-[12px] text-aegis-text-dim">
            {t('terminalSettings.description', '统一设置主终端、分屏终端和智能体终端的显示与输入行为。')}
          </p>
        </div>
        <div className="flex h-8 items-center gap-2">
          {saveState === 'saving' && <span className="inline-flex items-center gap-1.5 text-[11px] text-aegis-text-dim"><Loader2 size={12} className="animate-spin" />{t('terminalSettings.saving', '正在保存')}</span>}
          {saveState === 'saved' && <span className="inline-flex items-center gap-1.5 text-[11px] text-aegis-success"><Check size={12} />{t('terminalSettings.saved', '已保存')}</span>}
          <button type="button" onClick={() => void resetDefaults()} disabled={saveState === 'saving'} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[11px] text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:opacity-50">
            <RotateCcw size={12} />{t('terminalSettings.reset', '恢复默认')}
          </button>
        </div>
      </div>

      <GlassCard delay={0.04}>
        <div className="divide-y divide-aegis-border/60">
          <div className="grid gap-4 py-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div><div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.fontSize', '字号')}</div><p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.fontSizeHint', '立即应用到已打开的终端。')}</p></div>
            <div className="flex h-9 items-center rounded-md border border-aegis-border bg-aegis-input">
              <button type="button" aria-label={t('terminalSettings.decreaseFont', '减小字号')} onClick={() => setTerminalFontSize(terminalFontSize - 1)} disabled={terminalFontSize <= 10} className="flex h-full w-9 items-center justify-center text-aegis-text-muted hover:text-aegis-text disabled:opacity-35"><Minus size={13} /></button>
              <output className="w-12 text-center font-mono text-[12px] tabular-nums text-aegis-text">{terminalFontSize}px</output>
              <button type="button" aria-label={t('terminalSettings.increaseFont', '增大字号')} onClick={() => setTerminalFontSize(terminalFontSize + 1)} disabled={terminalFontSize >= 20} className="flex h-full w-9 items-center justify-center text-aegis-text-muted hover:text-aegis-text disabled:opacity-35"><Plus size={13} /></button>
            </div>
          </div>

          <div className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div><div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.fontFamily', '等宽字体')}</div><p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.fontFamilyHint', '同时用于终端、代码块和文件预览。')}</p></div>
            <select value={monoFont.replace(/^['"]|['"],\s*(?:monospace|sans-serif)$/g, '')} onChange={(event) => setMonoFont(event.target.value ? `'${event.target.value}', monospace` : '')} className="h-9 rounded-md border border-aegis-border bg-aegis-input px-3 text-[12px] text-aegis-text outline-none focus:border-aegis-primary/55">
              {fontOptions.map((font) => <option key={font || 'default'} value={font}>{font || t('terminalSettings.systemDefault', '系统默认')}</option>)}
            </select>
          </div>

          <div className="py-4">
            <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.scrollback', '回滚行数')}</div>
            <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.scrollbackHint', '应用于新打开的终端；数值越大，长时会话占用的内存越多。')}</p>
            <div className="mt-3 inline-flex max-w-full overflow-x-auto rounded-md border border-aegis-border bg-aegis-input p-0.5" role="radiogroup" aria-label={t('terminalSettings.scrollback', '回滚行数')}>
              {SCROLLBACK_OPTIONS.map((option) => <button key={option} type="button" role="radio" aria-checked={preferences.scrollback === option} disabled={preferences.loading || saveState === 'saving'} onClick={() => void saveScrollback(option)} className={clsx('h-8 min-w-14 rounded px-2.5 font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45', preferences.scrollback === option ? 'bg-aegis-primary/15 font-semibold text-aegis-primary' : 'text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text')}>{option}</button>)}
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard delay={0.08}>
        <div className="flex items-center justify-between gap-5">
          <div><div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.shiftEnter', 'Shift+Enter 换行')}</div><p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.shiftEnterHint', '在交互式终端中插入换行，不立即执行当前输入。')}</p></div>
          <PreferenceSwitch checked={shiftEnterNewline} disabled={preferences.loading || saveState === 'saving'} label={t('terminalSettings.shiftEnter', 'Shift+Enter 换行')} onChange={(next) => void saveShiftEnter(next)} />
        </div>
      </GlassCard>

      {(error || preferences.error) && <div role="alert" className="rounded-md border border-aegis-danger/25 bg-aegis-danger/8 px-3 py-2 text-[12px] text-aegis-danger">{t('terminalSettings.saveFailed', '终端设置保存失败：{{error}}', { error: error || preferences.error })}</div>}
    </section>
  );
}
