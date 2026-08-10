import { useEffect, useState } from 'react';
import { Check, Info, Plus, Radio, RefreshCw, Route, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type { JarvisVoiceSettingsState } from '@/hooks/useJarvisVoiceSettings';
import {
  MAX_VOICE_WAKE_TRIGGERS,
  MAX_VOICE_WAKE_TRIGGER_LENGTH,
  type VoiceWakeRouteTarget,
} from '@/types/voiceWake';

interface JarvisVoiceSettingsPanelProps {
  settings: JarvisVoiceSettingsState;
}

function routeTargetLabel(
  target: VoiceWakeRouteTarget,
  translate: (key: string) => string,
): string {
  if ('agentId' in target) return `${translate('settings.jarvisRouteAgent')}: ${target.agentId}`;
  if ('sessionKey' in target) return `${translate('settings.jarvisRouteSession')}: ${target.sessionKey}`;
  return translate('settings.jarvisRouteCurrent');
}

export function JarvisVoiceSettingsPanel({ settings }: JarvisVoiceSettingsPanelProps) {
  const { t } = useTranslation();
  const [triggerDrafts, setTriggerDrafts] = useState<string[]>(settings.gatewayTriggers);
  const [triggerValidation, setTriggerValidation] = useState<string | null>(null);
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

      <div className="flex items-start gap-2 border-b border-aegis-border px-4 py-3 text-[11px] leading-5 text-aegis-text-dim sm:px-5">
        <Info size={14} className="mt-0.5 shrink-0 text-aegis-primary" aria-hidden="true" />
        <p>{t('settings.jarvisBoundaryNotice')}</p>
      </div>

      <section className="border-b border-aegis-border px-4 py-4 sm:px-5" aria-labelledby="jarvis-talk-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="jarvis-talk-heading" className="text-[12px] font-semibold text-aegis-text">
              {t('settings.jarvisTalkStatus')}
            </h3>
            <p className="mt-1 text-[11px] text-aegis-text-muted">{t('settings.jarvisTalkStatusDescription')}</p>
          </div>
          <span role="status" className={settings.talkReady === true
            ? 'shrink-0 rounded-md border border-aegis-success/30 bg-aegis-success/10 px-2.5 py-1 text-[11px] font-semibold text-aegis-success'
            : settings.talkReady === false || settings.talkError
              ? 'shrink-0 rounded-md border border-aegis-warning/30 bg-aegis-warning/10 px-2.5 py-1 text-[11px] font-semibold text-aegis-warning'
              : 'shrink-0 rounded-md border border-aegis-border bg-aegis-surface px-2.5 py-1 text-[11px] font-semibold text-aegis-text-muted'}>
            {settings.loading && <LoadingIndicator size={11} />}
            {settings.talkReady === true
              ? t('settings.jarvisTalkReady', { provider: settings.talkProvider || t('settings.jarvisUnknownProvider') })
              : settings.talkReady === false || settings.talkError
                ? t('settings.jarvisTalkUnavailable')
                : settings.loading
                  ? t('settings.jarvisTalkChecking')
                  : t('settings.jarvisTalkUnverified')}
          </span>
        </div>
        {settings.talkError && (
          <p className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-aegis-warning" role="alert">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t(`settings.jarvisSettingsError.${settings.talkError}`)}
          </p>
        )}
      </section>

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
        <p className="mt-2 text-[11px] leading-5 text-aegis-text-muted">
          {t('settings.jarvisRoutingReadOnly')}
        </p>
        {settings.routing ? (
          <div className="mt-4 divide-y divide-aegis-border/60 rounded-md border border-aegis-border">
            <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
              <span className="text-[11px] text-aegis-text-muted">{t('settings.jarvisDefaultRoute')}</span>
              <span className="break-all font-mono text-[11px] text-aegis-text">
                {routeTargetLabel(settings.routing.defaultTarget, t)}
              </span>
            </div>
            {settings.routing.routes.length > 0 ? settings.routing.routes.map((route) => (
              <div key={`${route.trigger}:${JSON.stringify(route.target)}`} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[140px_minmax(0,1fr)]">
                <span className="break-words text-[11px] text-aegis-text">{route.trigger}</span>
                <span className="break-all font-mono text-[11px] text-aegis-text-muted">
                  {routeTargetLabel(route.target, t)}
                </span>
              </div>
            )) : (
              <p className="px-3 py-2.5 text-[11px] text-aegis-text-muted">{t('settings.jarvisRoutingNoRoutes')}</p>
            )}
          </div>
        ) : !settings.loading && (
          <p className="mt-3 text-[11px] leading-5 text-aegis-text-muted">{routingErrorMessage || t('settings.jarvisRoutingUnavailable')}</p>
        )}
        {settings.routing && settings.routingError && (
          <p role="alert" className="mt-3 border-s-2 border-aegis-danger ps-3 text-[11px] leading-5 text-aegis-danger">
            {routingErrorMessage}
          </p>
        )}
      </section>
    </div>
  );
}
