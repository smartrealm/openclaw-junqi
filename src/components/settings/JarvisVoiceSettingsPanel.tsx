import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Radio, RefreshCw, Route, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JarvisVoiceSettingsState } from '@/hooks/useJarvisVoiceSettings';
import {
  MAX_VOICE_WAKE_TRIGGERS,
  MAX_VOICE_WAKE_TRIGGER_LENGTH,
  isCanonicalVoiceWakeSessionKey,
  isValidVoiceWakeAgentId,
  isValidVoiceWakeRouteTarget,
  normalizeVoiceWakeRouteTrigger,
  type VoiceWakeRoute,
  type VoiceWakeRouteTarget,
  type VoiceWakeRoutingConfig,
} from '@/services/gateway/voiceWakeTypes';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { getSessionDisplayLabel } from '@/utils/sessionLabel';

interface JarvisVoiceSettingsPanelProps {
  settings: JarvisVoiceSettingsState;
}

type TargetMode = 'current' | 'agent' | 'session';

function cloneRouting(routing: VoiceWakeRoutingConfig): VoiceWakeRoutingConfig {
  return {
    ...routing,
    defaultTarget: { ...routing.defaultTarget },
    routes: routing.routes.map((route) => ({ trigger: route.trigger, target: { ...route.target } })),
  };
}

function targetMode(target: VoiceWakeRouteTarget): TargetMode {
  if ('agentId' in target) return 'agent';
  if ('sessionKey' in target) return 'session';
  return 'current';
}

function targetValue(target: VoiceWakeRouteTarget): string {
  if ('agentId' in target) return target.agentId;
  if ('sessionKey' in target) return target.sessionKey;
  return '';
}

function uniqueOptions<T extends { value: string; label: string }>(options: T[], current: string): T[] {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current } as T, ...options];
}

interface RouteTargetEditorProps {
  target: VoiceWakeRouteTarget;
  agentOptions: Array<{ value: string; label: string }>;
  sessionOptions: Array<{ value: string; label: string }>;
  onChange: (target: VoiceWakeRouteTarget) => void;
}

function RouteTargetEditor({
  target,
  agentOptions,
  sessionOptions,
  onChange,
}: RouteTargetEditorProps) {
  const { t } = useTranslation();
  const mode = targetMode(target);
  const value = targetValue(target);
  const availableAgents = uniqueOptions(agentOptions, mode === 'agent' ? value : '');
  const availableSessions = uniqueOptions(sessionOptions, mode === 'session' ? value : '');
  const selectClass = 'h-9 min-w-0 rounded-md border border-aegis-border bg-aegis-bg px-2 text-[12px] text-aegis-text focus:border-aegis-primary/70 focus:outline-none disabled:opacity-40';

  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-[130px_minmax(0,1fr)]">
      <select
        value={mode}
        onChange={(event) => {
          const next = event.target.value as TargetMode;
          if (next === 'current') onChange({ mode: 'current' });
          else if (next === 'agent' && availableAgents[0]) onChange({ agentId: availableAgents[0].value });
          else if (next === 'session' && availableSessions[0]) onChange({ sessionKey: availableSessions[0].value });
        }}
        className={selectClass}
        aria-label={t('settings.jarvisRouteTargetType')}
      >
        <option value="current">{t('settings.jarvisRouteCurrent')}</option>
        <option value="agent" disabled={availableAgents.length === 0}>{t('settings.jarvisRouteAgent')}</option>
        <option value="session" disabled={availableSessions.length === 0}>{t('settings.jarvisRouteSession')}</option>
      </select>
      {mode === 'agent' && (
        <select
          value={value}
          onChange={(event) => onChange({ agentId: event.target.value })}
          className={selectClass}
          aria-label={t('settings.jarvisRouteAgent')}
        >
          {availableAgents.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
      {mode === 'session' && (
        <select
          value={value}
          onChange={(event) => onChange({ sessionKey: event.target.value })}
          className={selectClass}
          aria-label={t('settings.jarvisRouteSession')}
        >
          {availableSessions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </div>
  );
}

export function JarvisVoiceSettingsPanel({ settings }: JarvisVoiceSettingsPanelProps) {
  const { t } = useTranslation();
  const agents = useGatewayDataStore((state) => state.agents);
  const sessions = useChatStore((state) => state.sessions);
  const [triggerDrafts, setTriggerDrafts] = useState<string[]>(settings.gatewayTriggers);
  const [routingDraft, setRoutingDraft] = useState<VoiceWakeRoutingConfig | null>(
    settings.routing ? cloneRouting(settings.routing) : null,
  );
  const [triggerValidation, setTriggerValidation] = useState<string | null>(null);
  const [routingValidation, setRoutingValidation] = useState<string | null>(null);
  const triggerErrorMessage = settings.triggerError
    ? t(`settings.jarvisSettingsError.${settings.triggerError}`)
    : null;
  const routingErrorMessage = settings.routingError
    ? t(`settings.jarvisSettingsError.${settings.routingError}`)
    : null;

  useEffect(() => {
    setTriggerDrafts([...settings.gatewayTriggers]);
    setTriggerValidation(null);
  }, [settings.gatewayTriggers]);

  useEffect(() => {
    setRoutingDraft(settings.routing ? cloneRouting(settings.routing) : null);
    setRoutingValidation(null);
  }, [settings.routing]);

  const agentOptions = useMemo(() => agents
    .filter((agent) => isValidVoiceWakeAgentId(agent.id))
    .map((agent) => ({
      value: agent.id,
      label: agent.name?.trim() || agent.id,
    })), [agents]);
  const sessionOptions = useMemo(() => sessions
    .filter((session) => isCanonicalVoiceWakeSessionKey(session.key))
    .map((session) => ({
      value: session.key,
      label: getSessionDisplayLabel(session, {
        mainSessionLabel: t('dashboard.mainSession', 'Main Session'),
        genericSessionLabel: t('dashboard.session', 'Session'),
      }),
    })), [sessions, t]);

  const updateRoute = (index: number, update: (route: VoiceWakeRoute) => VoiceWakeRoute) => {
    setRoutingDraft((current) => current ? {
      ...current,
      routes: current.routes.map((route, routeIndex) => routeIndex === index ? update(route) : route),
    } : current);
  };

  const saveTriggers = async () => {
    const normalized = triggerDrafts.map((trigger) => trigger.trim()).filter(Boolean);
    if (normalized.length > MAX_VOICE_WAKE_TRIGGERS
      || normalized.some((trigger) => trigger.length > MAX_VOICE_WAKE_TRIGGER_LENGTH)) {
      setTriggerValidation(t('settings.jarvisTriggerLimit', {
        count: MAX_VOICE_WAKE_TRIGGERS,
        length: MAX_VOICE_WAKE_TRIGGER_LENGTH,
      }));
      return;
    }
    setTriggerValidation(null);
    await settings.saveTriggers(normalized);
  };

  const saveRouting = async () => {
    if (!routingDraft) return;
    const normalizedKeys = new Set<string>();
    if (!isValidVoiceWakeRouteTarget(routingDraft.defaultTarget)
      || routingDraft.routes.some((route) => !isValidVoiceWakeRouteTarget(route.target))) {
      setRoutingValidation(t('settings.jarvisRouteInvalid'));
      return;
    }
    for (const route of routingDraft.routes) {
      const trigger = route.trigger.trim();
      const normalized = normalizeVoiceWakeRouteTrigger(trigger);
      if (!trigger || trigger.length > MAX_VOICE_WAKE_TRIGGER_LENGTH || !normalized || normalizedKeys.has(normalized)) {
        setRoutingValidation(t('settings.jarvisRouteInvalid'));
        return;
      }
      normalizedKeys.add(normalized);
    }
    setRoutingValidation(null);
    await settings.saveRouting({
      ...routingDraft,
      routes: routingDraft.routes.map((route) => ({ ...route, trigger: route.trigger.trim() })),
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-aegis-border bg-aegis-bg-panel">
      <header className="flex items-center justify-between gap-4 border-b border-aegis-border px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md border border-aegis-primary/30 bg-aegis-primary/10 text-aegis-primary">
            <Radio size={17} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-aegis-text">{t('settings.jarvisTitle')}</h2>
            <p className="truncate text-[11px] text-aegis-text-dim">{t('settings.jarvisGatewayAuthority')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void settings.refresh(); }}
          disabled={settings.loading}
          className="grid size-9 shrink-0 place-items-center rounded-md border border-aegis-border text-aegis-text-muted transition-colors hover:border-aegis-primary/45 hover:text-aegis-primary disabled:opacity-40"
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
        >
          <RefreshCw size={15} className={settings.loading ? 'animate-spin motion-reduce:animate-none' : ''} />
        </button>
      </header>

      <section className="border-b border-aegis-border px-4 py-5 sm:px-5" aria-labelledby="jarvis-trigger-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="jarvis-trigger-heading" className="text-[12px] font-semibold text-aegis-text">{t('settings.jarvisWakePhrases')}</h3>
          <span className="text-[10px] text-aegis-text-dim">{triggerDrafts.length}/{MAX_VOICE_WAKE_TRIGGERS}</span>
        </div>
        <div className="mt-3 space-y-2">
          {triggerDrafts.map((trigger, index) => (
            <div key={`${index}-${settings.gatewayTriggers[index] ?? ''}`} className="flex items-center gap-2">
              <input
                value={trigger}
                maxLength={MAX_VOICE_WAKE_TRIGGER_LENGTH}
                onChange={(event) => setTriggerDrafts((current) => current.map((value, itemIndex) => (
                  itemIndex === index ? event.target.value : value
                )))}
                className="h-9 min-w-0 flex-1 rounded-md border border-aegis-border bg-aegis-bg px-3 text-[12px] text-aegis-text focus:border-aegis-primary/70 focus:outline-none"
                aria-label={t('settings.jarvisWakePhraseNumber', { number: index + 1 })}
              />
              <button
                type="button"
                onClick={() => setTriggerDrafts((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                className="grid size-9 shrink-0 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger"
                title={t('common.delete')}
                aria-label={t('common.delete')}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setTriggerDrafts((current) => [...current, ''])}
            disabled={triggerDrafts.length >= MAX_VOICE_WAKE_TRIGGERS}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-aegis-border px-3 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.05)] disabled:opacity-40"
          >
            <Plus size={14} />
            {t('settings.jarvisAddTrigger')}
          </button>
          <button
            type="button"
            onClick={() => { void saveTriggers(); }}
            disabled={settings.savingTriggers}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-aegis-primary px-3 text-[11px] font-semibold text-white transition-colors hover:bg-aegis-primary/85 disabled:opacity-40"
          >
            <Check size={14} />
            {t('settings.jarvisSaveTriggers')}
          </button>
        </div>
        {(triggerValidation || triggerErrorMessage) && (
          <p role="alert" className="mt-3 border-s-2 border-aegis-danger ps-3 text-[11px] leading-5 text-aegis-danger">
            {triggerValidation || triggerErrorMessage}
          </p>
        )}
      </section>

      <section className="px-4 py-5 sm:px-5" aria-labelledby="jarvis-routing-heading">
        <div className="flex items-center gap-2">
          <Route size={15} className="text-aegis-primary" />
          <h3 id="jarvis-routing-heading" className="text-[12px] font-semibold text-aegis-text">{t('settings.jarvisRouting')}</h3>
        </div>
        {routingDraft ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-[150px_minmax(0,1fr)] sm:items-center">
              <label className="text-[11px] text-aegis-text-muted">{t('settings.jarvisDefaultRoute')}</label>
              <RouteTargetEditor
                target={routingDraft.defaultTarget}
                agentOptions={agentOptions}
                sessionOptions={sessionOptions}
                onChange={(defaultTarget) => setRoutingDraft((current) => current ? { ...current, defaultTarget } : current)}
              />
            </div>

            <div className="mt-5 space-y-2">
              {routingDraft.routes.map((route, index) => (
                <div key={`${index}-${settings.routing?.routes[index]?.trigger ?? ''}`} className="grid gap-2 border-t border-aegis-border/60 pt-3 sm:grid-cols-[minmax(120px,0.75fr)_minmax(220px,1.25fr)_36px] sm:items-center">
                  <input
                    value={route.trigger}
                    maxLength={MAX_VOICE_WAKE_TRIGGER_LENGTH}
                    onChange={(event) => updateRoute(index, (current) => ({ ...current, trigger: event.target.value }))}
                    className="h-9 min-w-0 rounded-md border border-aegis-border bg-aegis-bg px-3 text-[12px] text-aegis-text focus:border-aegis-primary/70 focus:outline-none"
                    aria-label={t('settings.jarvisRouteTriggerNumber', { number: index + 1 })}
                  />
                  <RouteTargetEditor
                    target={route.target}
                    agentOptions={agentOptions}
                    sessionOptions={sessionOptions}
                    onChange={(target) => updateRoute(index, (current) => ({ ...current, target }))}
                  />
                  <button
                    type="button"
                    onClick={() => setRoutingDraft((current) => current ? {
                      ...current,
                      routes: current.routes.filter((_, routeIndex) => routeIndex !== index),
                    } : current)}
                    className="grid size-9 place-items-center rounded-md text-aegis-text-muted transition-colors hover:bg-aegis-danger/10 hover:text-aegis-danger"
                    title={t('common.delete')}
                    aria-label={t('common.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setRoutingDraft((current) => current ? {
                  ...current,
                  routes: [...current.routes, {
                    trigger: triggerDrafts.find((trigger) => trigger.trim())?.trim() || '',
                    target: { mode: 'current' },
                  }],
                } : current)}
                disabled={routingDraft.routes.length >= MAX_VOICE_WAKE_TRIGGERS}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-aegis-border px-3 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.05)] disabled:opacity-40"
              >
                <Plus size={14} />
                {t('settings.jarvisAddRoute')}
              </button>
              <button
                type="button"
                onClick={() => { void saveRouting(); }}
                disabled={settings.savingRouting}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-aegis-primary px-3 text-[11px] font-semibold text-white transition-colors hover:bg-aegis-primary/85 disabled:opacity-40"
              >
                <Check size={14} />
                {t('settings.jarvisSaveRouting')}
              </button>
            </div>
          </>
        ) : !settings.loading && (
          <p className="mt-3 text-[11px] leading-5 text-aegis-text-muted">{routingErrorMessage || t('settings.jarvisRoutingUnavailable')}</p>
        )}
        {(routingValidation || (routingDraft && settings.routingError)) && (
          <p role="alert" className="mt-3 border-s-2 border-aegis-danger ps-3 text-[11px] leading-5 text-aegis-danger">
            {routingValidation || routingErrorMessage}
          </p>
        )}
      </section>
    </div>
  );
}
