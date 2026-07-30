import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, FolderOpen, Minus, Plus, RotateCcw, TerminalSquare, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { GlassCard } from '@/components/shared/GlassCard';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE,
  TERMINAL_SETTINGS_CHANGED_EVENT,
  useTerminalPreferences,
} from '@/hooks/useTerminalPreferences';
import { terminalAgentLauncher } from '@/components/Terminal/terminalAgentCatalog';
import {
  getTerminalAgentPreferencesSnapshot,
  moveTerminalAgent,
  resetTerminalAgentPreferences,
  setTerminalAgentHidden,
  setTerminalDefaultLauncher,
  subscribeTerminalAgentPreferences,
  visibleTerminalAgentIds,
} from '@/components/Terminal/terminalAgentPreferences';
import {
  addTerminalPreset,
  deleteTerminalPreset,
  getTerminalPresetPreferencesSnapshot,
  moveTerminalPreset,
  resetTerminalPresetPreferences,
  setTerminalPresetHidden,
  subscribeTerminalPresetPreferences,
  terminalPresetDisplayTitle,
  updateTerminalPreset,
  visibleTerminalPresets,
} from '@/components/Terminal/terminalPresets';
import {
  addTerminalCustomAgent,
  deleteTerminalCustomAgent,
  getTerminalCustomAgentPreferencesSnapshot,
  moveTerminalCustomAgent,
  resetTerminalCustomAgentPreferences,
  setTerminalCustomAgentHidden,
  subscribeTerminalCustomAgentPreferences,
  terminalCustomAgentDisplayTitle,
  updateTerminalCustomAgent,
  visibleTerminalCustomAgents,
} from '@/components/Terminal/terminalCustomAgents';
import { TERMINAL_AGENT_LAUNCHERS, type TerminalAgentId } from '@/components/Terminal/terminalAgentCatalog';
import {
  getTerminalOpenInPreferencesSnapshot,
  moveTerminalOpenInApp,
  resetTerminalOpenInPreferences,
  setTerminalOpenInAppHidden,
  subscribeTerminalOpenInPreferences,
  orderedTerminalOpenInApps,
} from '@/components/Terminal/terminalOpenInPreferences';
import { TerminalOpenInAppIcon, type TerminalOpenInApp } from '@/components/Terminal/TerminalOpenInAppIcon';
import {
  getTerminalStatusPreferencesSnapshot,
  moveTerminalStatusItem,
  resetTerminalStatusPreferences,
  setTerminalStatusItemHidden,
  subscribeTerminalStatusPreferences,
} from '@/components/Terminal/terminalStatusPreferences';
import {
  getTerminalAppearancePreferencesSnapshot,
  resetTerminalAppearancePreferences,
  setTerminalCursorStyle,
  subscribeTerminalAppearancePreferences,
} from '@/components/Terminal/terminalAppearancePreferences';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FontSelector } from '@/components/settings/FontSelector';
import { SettingsSwitch } from '@/components/settings/SettingsSwitch';
import { commitTerminalSettingsReset } from './terminalSettingsTransaction';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

const SCROLLBACK_OPTIONS = [500, 1000, 2000, 3000, 5000] as const;
type SaveState = 'idle' | 'saving' | 'saved';

function TerminalAgentLaunchPreferences() {
  const { t } = useTranslation();
  const preferences = useSyncExternalStore(
    subscribeTerminalAgentPreferences,
    getTerminalAgentPreferencesSnapshot,
    getTerminalAgentPreferencesSnapshot,
  );
  const presetPreferences = useSyncExternalStore(
    subscribeTerminalPresetPreferences,
    getTerminalPresetPreferencesSnapshot,
    getTerminalPresetPreferencesSnapshot,
  );
  const customAgentPreferences = useSyncExternalStore(
    subscribeTerminalCustomAgentPreferences,
    getTerminalCustomAgentPreferencesSnapshot,
    getTerminalCustomAgentPreferencesSnapshot,
  );
  const hidden = new Set(preferences.hiddenAgentIds);
  const visible = visibleTerminalAgentIds(preferences);
  const presets = visibleTerminalPresets(presetPreferences);
  const customAgents = visibleTerminalCustomAgents(customAgentPreferences);

  return (
    <GlassCard delay={0.12}>
      <div className="divide-y divide-aegis-border/60">
        <div className="grid gap-4 pb-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
          <div>
            <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.defaultLauncher')}</div>
            <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.defaultLauncherHint')}</p>
          </div>
          <select
            value={preferences.defaultLauncherId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setTerminalDefaultLauncher(value === '' ? null : value);
            }}
            className="h-9 rounded-md border border-aegis-border bg-aegis-input px-3 text-[12px] text-aegis-text outline-none focus:border-aegis-primary/55"
          >
            <option value="">{t('terminalSettings.showLaunchMenu')}</option>
            <option value="terminal">{t('terminal.newTerminal', 'Terminal')}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{terminalPresetDisplayTitle(preset)}</option>
            ))}
            {visible.map((id) => (
              <option key={id} value={id}>{terminalAgentLauncher(id).label}</option>
            ))}
            {customAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>{terminalCustomAgentDisplayTitle(agent)}</option>
            ))}
          </select>
        </div>

        <div className="pt-4">
          <div className="mb-2 text-[13px] font-medium text-aegis-text">{t('terminalSettings.launcherOrder')}</div>
          <div className="overflow-hidden rounded-md border border-aegis-border/70">
            {preferences.orderedAgentIds.map((id, index) => {
              const launcher = terminalAgentLauncher(id);
              const isHidden = hidden.has(id);
              return (
                <div key={id} className="flex h-10 items-center gap-1.5 border-b border-aegis-border/50 px-2 last:border-b-0">
                  <span className={clsx('min-w-0 flex-1 truncate text-[12px]', isHidden ? 'text-aegis-text-dim line-through' : 'text-aegis-text')}>{launcher.label}</span>
                  <button
                    type="button"
                    onClick={() => moveTerminalAgent(id, -1)}
                    disabled={index === 0}
                    title={t('terminalSettings.moveAgentUp')}
                    aria-label={t('terminalSettings.moveAgentUp')}
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"
                  ><ArrowUp size={13} /></button>
                  <button
                    type="button"
                    onClick={() => moveTerminalAgent(id, 1)}
                    disabled={index === preferences.orderedAgentIds.length - 1}
                    title={t('terminalSettings.moveAgentDown')}
                    aria-label={t('terminalSettings.moveAgentDown')}
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"
                  ><ArrowDown size={13} /></button>
                  <button
                    type="button"
                    onClick={() => setTerminalAgentHidden(id, !isHidden)}
                    title={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')}
                    aria-label={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')}
                    className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text"
                  >{isHidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function TerminalPresetPreferences() {
  const { t } = useTranslation();
  const preferences = useSyncExternalStore(
    subscribeTerminalPresetPreferences,
    getTerminalPresetPreferencesSnapshot,
    getTerminalPresetPreferencesSnapshot,
  );
  const hidden = new Set(preferences.hiddenPresetIds);

  const chooseDirectory = async (id: string, currentPath: string) => {
    try {
      const selected = await openDialog({ directory: true, multiple: false, defaultPath: currentPath || undefined });
      if (typeof selected === 'string' && selected.trim()) updateTerminalPreset(id, { path: selected });
    } catch {
      // Text entry remains available in browser-only development mode.
    }
  };

  return (
    <GlassCard delay={0.14}>
      <div className="flex items-center gap-3 border-b border-aegis-border/60 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.presets')}</div>
          <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.presetsHint')}</p>
        </div>
        <button
          type="button"
          title={t('terminalSettings.addPreset')}
          aria-label={t('terminalSettings.addPreset')}
          onClick={addTerminalPreset}
          className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-aegis-border text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text"
        ><Plus size={14} /></button>
      </div>
      <div className="mt-3 space-y-2">
        {preferences.presets.length === 0 && (
          <div className="py-2 text-[11px] text-aegis-text-dim">{t('terminalSettings.noPresets')}</div>
        )}
        {preferences.presets.map((preset, index) => {
          const isHidden = hidden.has(preset.id);
          return (
            <div key={preset.id} className={clsx('grid gap-2 border border-aegis-border/65 p-2 sm:grid-cols-[minmax(100px,0.7fr)_minmax(180px,1.3fr)_auto]', isHidden && 'opacity-55')}>
              <input
                value={preset.title}
                onChange={(event) => updateTerminalPreset(preset.id, { title: event.target.value })}
                placeholder={terminalPresetDisplayTitle(preset)}
                aria-label={t('terminalSettings.presetTitle')}
                className="h-8 min-w-0 rounded-[4px] border border-aegis-border bg-aegis-input px-2 text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55"
              />
              <div className="flex min-w-0">
                <input
                  value={preset.path}
                  onChange={(event) => updateTerminalPreset(preset.id, { path: event.target.value })}
                  placeholder="~/project"
                  aria-label={t('terminalSettings.presetPath')}
                  className="h-8 min-w-0 flex-1 rounded-s-[4px] border border-aegis-border bg-aegis-input px-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55"
                />
                <button
                  type="button"
                  title={t('terminalSettings.choosePresetDirectory')}
                  aria-label={t('terminalSettings.choosePresetDirectory')}
                  onClick={() => void chooseDirectory(preset.id, preset.path)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-e-[4px] border border-s-0 border-aegis-border bg-aegis-input text-aegis-text-dim transition-colors hover:bg-aegis-hover hover:text-aegis-text"
                ><FolderOpen size={13} /></button>
              </div>
              <div className="flex items-center justify-end gap-0.5">
                <button type="button" title={t('terminalSettings.moveAgentUp')} aria-label={t('terminalSettings.moveAgentUp')} onClick={() => moveTerminalPreset(preset.id, -1)} disabled={index === 0} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowUp size={13} /></button>
                <button type="button" title={t('terminalSettings.moveAgentDown')} aria-label={t('terminalSettings.moveAgentDown')} onClick={() => moveTerminalPreset(preset.id, 1)} disabled={index === preferences.presets.length - 1} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowDown size={13} /></button>
                <button type="button" title={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} aria-label={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} onClick={() => setTerminalPresetHidden(preset.id, !isHidden)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{isHidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                <button type="button" title={t('terminalSettings.deletePreset')} aria-label={t('terminalSettings.deletePreset')} onClick={() => deleteTerminalPreset(preset.id)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-danger/15 hover:text-aegis-danger"><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function TerminalCustomAgentPreferences() {
  const { t } = useTranslation();
  const preferences = useSyncExternalStore(
    subscribeTerminalCustomAgentPreferences,
    getTerminalCustomAgentPreferencesSnapshot,
    getTerminalCustomAgentPreferencesSnapshot,
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const hidden = new Set(preferences.hiddenAgentIds);
  const toggleExpanded = (id: string) => setExpandedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const add = () => {
    const created = addTerminalCustomAgent();
    setExpandedIds((current) => new Set([...current, created.id]));
  };

  return (
    <GlassCard delay={0.16}>
      <div className="flex items-center gap-3 border-b border-aegis-border/60 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.customAgents')}</div>
          <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.customAgentsHint')}</p>
        </div>
        <button type="button" title={t('terminalSettings.addCustomAgent')} aria-label={t('terminalSettings.addCustomAgent')} onClick={add} className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-aegis-border text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text"><Plus size={14} /></button>
      </div>
      <div className="mt-3 space-y-2">
        {preferences.agents.length === 0 && <div className="py-2 text-[11px] text-aegis-text-dim">{t('terminalSettings.noCustomAgents')}</div>}
        {preferences.agents.map((agent, index) => {
          const isHidden = hidden.has(agent.id);
          const expanded = expandedIds.has(agent.id);
          return (
            <div key={agent.id} className={clsx('border border-aegis-border/65', isHidden && 'opacity-55')}>
              <div className="flex min-h-10 items-center gap-2 px-2">
                <button type="button" onClick={() => toggleExpanded(agent.id)} aria-expanded={expanded} className="min-w-0 flex-1 truncate text-left text-[12px] text-aegis-text hover:text-aegis-primary">
                  {terminalCustomAgentDisplayTitle(agent)}
                </button>
                <div className="flex items-center gap-0.5">
                  <button type="button" title={t('terminalSettings.moveAgentUp')} aria-label={t('terminalSettings.moveAgentUp')} onClick={() => moveTerminalCustomAgent(agent.id, -1)} disabled={index === 0} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button type="button" title={t('terminalSettings.moveAgentDown')} aria-label={t('terminalSettings.moveAgentDown')} onClick={() => moveTerminalCustomAgent(agent.id, 1)} disabled={index === preferences.agents.length - 1} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowDown size={13} /></button>
                  <button type="button" title={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} aria-label={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} onClick={() => setTerminalCustomAgentHidden(agent.id, !isHidden)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{isHidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  <button type="button" title={t('terminalSettings.deleteCustomAgent')} aria-label={t('terminalSettings.deleteCustomAgent')} onClick={() => deleteTerminalCustomAgent(agent.id)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-danger/15 hover:text-aegis-danger"><Trash2 size={13} /></button>
                </div>
              </div>
              {expanded && (
                <div className="grid gap-2 border-t border-aegis-border/60 p-2 sm:grid-cols-2">
                  <label className="grid gap-1 text-[10px] text-aegis-text-dim">
                    {t('terminalSettings.customAgentTitle')}
                    <input value={agent.title} onChange={(event) => updateTerminalCustomAgent(agent.id, { title: event.target.value })} placeholder={agent.id} className="h-8 rounded-[4px] border border-aegis-border bg-aegis-input px-2 text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55" />
                  </label>
                  <label className="grid gap-1 text-[10px] text-aegis-text-dim">
                    {t('terminalSettings.customAgentBase')}
                    <select value={agent.baseAgentId ?? ''} onChange={(event) => updateTerminalCustomAgent(agent.id, { baseAgentId: event.target.value ? event.target.value as TerminalAgentId : null })} className="h-8 rounded-[4px] border border-aegis-border bg-aegis-input px-2 text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55">
                      <option value="">{t('terminalSettings.noBaseAgent')}</option>
                      {TERMINAL_AGENT_LAUNCHERS.map((builtin) => <option key={builtin.id} value={builtin.id}>{builtin.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[10px] text-aegis-text-dim sm:col-span-2">
                    {t('terminalSettings.customAgentCommand')}
                    <input value={agent.command} onChange={(event) => updateTerminalCustomAgent(agent.id, { command: event.target.value })} placeholder={agent.baseAgentId ?? 'aichat --model example'} className="h-8 rounded-[4px] border border-aegis-border bg-aegis-input px-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55" />
                  </label>
                  <label className="grid gap-1 text-[10px] text-aegis-text-dim sm:col-span-2">
                    {t('terminalSettings.customAgentEnv')}
                    <textarea value={agent.env} onChange={(event) => updateTerminalCustomAgent(agent.id, { env: event.target.value })} placeholder="KEY=value" rows={2} className="resize-y rounded-[4px] border border-aegis-border bg-aegis-input px-2 py-1.5 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary/55" />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function TerminalOpenInPreferences() {
  const { t } = useTranslation();
  const [apps, setApps] = useState<TerminalOpenInApp[]>([]);
  const [loading, setLoading] = useState(true);
  const preferences = useSyncExternalStore(
    subscribeTerminalOpenInPreferences,
    getTerminalOpenInPreferencesSnapshot,
    getTerminalOpenInPreferencesSnapshot,
  );
  const orderedApps = useMemo(
    () => orderedTerminalOpenInApps(apps, preferences),
    [apps, preferences],
  );
  const hidden = new Set(preferences.hiddenAppIds);

  useEffect(() => {
    let cancelled = false;
    void invoke<TerminalOpenInApp[]>('list_terminal_open_in_apps')
      .then((result) => { if (!cancelled) setApps(result ?? []); })
      .catch(() => { if (!cancelled) setApps([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <GlassCard delay={0.18}>
      <div className="flex items-center gap-3 border-b border-aegis-border/60 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.openIn')}</div>
          <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.openInHint')}</p>
        </div>
        <button type="button" title={t('terminalSettings.reset', '恢复默认')} aria-label={t('terminalSettings.reset', '恢复默认')} onClick={resetTerminalOpenInPreferences} className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-aegis-border text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text"><RotateCcw size={13} /></button>
      </div>
      <div className="mt-3 overflow-hidden border border-aegis-border/65">
        {loading && <div className="px-2 py-3 text-[11px] text-aegis-text-dim">{t('common.loading', 'Loading...')}</div>}
        {!loading && orderedApps.length === 0 && <div className="px-2 py-3 text-[11px] text-aegis-text-dim">{t('terminalSettings.noOpenInApps')}</div>}
        {orderedApps.map((app, index) => {
          const isHidden = hidden.has(app.id);
          return (
            <div key={app.id} className={clsx('flex h-10 items-center gap-1.5 border-b border-aegis-border/50 px-2 last:border-b-0', isHidden && 'opacity-55')}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center text-aegis-text-muted"><TerminalOpenInAppIcon app={app} size={16} /></span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-aegis-text">{app.label}</span>
              {preferences.lastUsedAppId === app.id && <span className="text-[9px] text-aegis-primary">{t('terminalSettings.defaultBadge')}</span>}
              <button type="button" title={t('terminalSettings.moveAgentUp')} aria-label={t('terminalSettings.moveAgentUp')} onClick={() => moveTerminalOpenInApp(app.id, -1, orderedApps.map((entry) => entry.id))} disabled={index === 0} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" title={t('terminalSettings.moveAgentDown')} aria-label={t('terminalSettings.moveAgentDown')} onClick={() => moveTerminalOpenInApp(app.id, 1, orderedApps.map((entry) => entry.id))} disabled={index === orderedApps.length - 1} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" title={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} aria-label={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} onClick={() => setTerminalOpenInAppHidden(app.id, !isHidden)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{isHidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

function TerminalStatusBarPreferences() {
  const { t } = useTranslation();
  const preferences = useSyncExternalStore(
    subscribeTerminalStatusPreferences,
    getTerminalStatusPreferencesSnapshot,
    getTerminalStatusPreferencesSnapshot,
  );
  const hidden = new Set(preferences.hiddenItems);

  return (
    <GlassCard delay={0.2}>
      <div className="flex items-center gap-3 border-b border-aegis-border/60 pb-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.statusBar')}</div>
          <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.statusBarHint')}</p>
        </div>
        <button type="button" title={t('terminalSettings.reset', '恢复默认')} aria-label={t('terminalSettings.reset', '恢复默认')} onClick={resetTerminalStatusPreferences} className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-aegis-border text-aegis-text-muted transition-colors hover:bg-aegis-hover hover:text-aegis-text"><RotateCcw size={13} /></button>
      </div>
      <div className="mt-3 overflow-hidden border border-aegis-border/65">
        {preferences.orderedItems.map((item, index) => {
          const isHidden = hidden.has(item);
          return (
            <div key={item} className={clsx('flex h-10 items-center gap-1.5 border-b border-aegis-border/50 px-2 last:border-b-0', isHidden && 'opacity-55')}>
              <span className="min-w-0 flex-1 truncate text-[12px] text-aegis-text">{t(`terminalSettings.statusItems.${item}`)}</span>
              <button type="button" title={t('terminalSettings.moveAgentUp')} aria-label={t('terminalSettings.moveAgentUp')} onClick={() => moveTerminalStatusItem(item, -1)} disabled={index === 0} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowUp size={13} /></button>
              <button type="button" title={t('terminalSettings.moveAgentDown')} aria-label={t('terminalSettings.moveAgentDown')} onClick={() => moveTerminalStatusItem(item, 1)} disabled={index === preferences.orderedItems.length - 1} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-30"><ArrowDown size={13} /></button>
              <button type="button" title={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} aria-label={isHidden ? t('terminalSettings.showAgent') : t('terminalSettings.hideAgent')} onClick={() => setTerminalStatusItemHidden(item, !isHidden)} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{isHidden ? <EyeOff size={13} /> : <Eye size={13} />}</button>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

export function TerminalSettingsPanel() {
  const { t } = useTranslation();
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const setTerminalFontSize = useSettingsStore((state) => state.setTerminalFontSize);
  const monoFont = useSettingsStore((state) => state.monoFont);
  const setMonoFont = useSettingsStore((state) => state.setMonoFont);
  const preferences = useTerminalPreferences();
  const appearancePreferences = useSyncExternalStore(
    subscribeTerminalAppearancePreferences,
    getTerminalAppearancePreferencesSnapshot,
    getTerminalAppearancePreferencesSnapshot,
  );
  const [shiftEnterNewline, setShiftEnterNewline] = useState(DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setShiftEnterNewline(preferences.shiftEnterNewline), [preferences.shiftEnterNewline]);

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
    setSaveState('saving');
    setError(null);
    try {
      await commitTerminalSettingsReset(
        () => invoke('reset_terminal_settings'),
        () => {
          setTerminalFontSize(12);
          setMonoFont('');
          setShiftEnterNewline(DEFAULT_TERMINAL_SHIFT_ENTER_NEWLINE);
          resetTerminalAgentPreferences();
          resetTerminalPresetPreferences();
          resetTerminalCustomAgentPreferences();
          resetTerminalOpenInPreferences();
          resetTerminalStatusPreferences();
          resetTerminalAppearancePreferences();
        },
      );
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
          {saveState === 'saving' && <span className="inline-flex items-center gap-1.5 text-[11px] text-aegis-text-dim"><LoadingIndicator size={12} />{t('terminalSettings.saving', '正在保存')}</span>}
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

          <FontSelector
            value={monoFont}
            onChange={setMonoFont}
            label={t('terminalSettings.fontFamily', '等宽字体')}
            description={t('terminalSettings.fontFamilyHint', '用于所有终端；编辑器字体留空时也跟随此设置。')}
            defaultLabel={t('font.junqiDefault', 'JunQi 默认')}
            role="mono"
          />

          <div className="grid gap-4 py-4 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center">
            <div><div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.cursorStyle')}</div><p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.cursorStyleHint')}</p></div>
            <select value={appearancePreferences.cursorStyle} onChange={(event) => setTerminalCursorStyle(event.target.value as 'block' | 'bar' | 'underline')} className="h-9 rounded-md border border-aegis-border bg-aegis-input px-3 text-[12px] text-aegis-text outline-none focus:border-aegis-primary/55">
              <option value="block">{t('terminalSettings.cursorBlock')}</option>
              <option value="bar">{t('terminalSettings.cursorBar')}</option>
              <option value="underline">{t('terminalSettings.cursorUnderline')}</option>
            </select>
          </div>

          <div className="py-4">
            <div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.scrollback', '回滚行数')}</div>
            <p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.scrollbackHint', '立即应用到已打开和新打开的终端；数值越大，长时会话占用的内存越多。')}</p>
            <div className="mt-3 inline-flex max-w-full overflow-x-auto rounded-md border border-aegis-border bg-aegis-input p-0.5" role="radiogroup" aria-label={t('terminalSettings.scrollback', '回滚行数')}>
              {SCROLLBACK_OPTIONS.map((option) => <button key={option} type="button" role="radio" aria-checked={preferences.scrollback === option} disabled={preferences.loading || saveState === 'saving'} onClick={() => void saveScrollback(option)} className={clsx('h-8 min-w-14 rounded px-2.5 font-mono text-[11px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45', preferences.scrollback === option ? 'bg-aegis-primary/15 font-semibold text-aegis-primary' : 'text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text')}>{option}</button>)}
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard delay={0.08}>
        <div className="flex items-center justify-between gap-5">
          <div><div className="text-[13px] font-medium text-aegis-text">{t('terminalSettings.shiftEnter', 'Shift+Enter 换行')}</div><p className="mt-1 text-[11px] text-aegis-text-dim">{t('terminalSettings.shiftEnterHint', '在交互式终端中插入换行，不立即执行当前输入。')}</p></div>
          <SettingsSwitch checked={shiftEnterNewline} disabled={preferences.loading || saveState === 'saving'} label={t('terminalSettings.shiftEnter', 'Shift+Enter 换行')} onCheckedChange={(next) => void saveShiftEnter(next)} />
        </div>
      </GlassCard>

      <TerminalAgentLaunchPreferences />
      <TerminalPresetPreferences />
      <TerminalCustomAgentPreferences />
      <TerminalOpenInPreferences />
      <TerminalStatusBarPreferences />

      {(error || preferences.error) && <div role="alert" className="rounded-md border border-aegis-danger/25 bg-aegis-danger/8 px-3 py-2 text-[12px] text-aegis-danger">{t('terminalSettings.saveFailed', '终端设置保存失败：{{error}}', { error: error || preferences.error })}</div>}
    </section>
  );
}
