import { useEffect, useState } from 'react';
import { Check, FolderOpen, Power, Radio, RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { JarvisVoiceSettingsState } from '@/hooks/useJarvisVoiceSettings';

interface JarvisVoiceSettingsPanelProps {
  settings: JarvisVoiceSettingsState;
}

export function JarvisVoiceSettingsPanel({ settings }: JarvisVoiceSettingsPanelProps) {
  const { t } = useTranslation();
  const [draftKeywords, setDraftKeywords] = useState<string[]>(settings.selectedKeywords);

  useEffect(() => {
    setDraftKeywords(settings.selectedKeywords);
  }, [settings.selectedKeywords]);

  const toggleKeyword = (keyword: string) => {
    setDraftKeywords((current) => current.includes(keyword)
      ? current.filter((candidate) => candidate !== keyword)
      : [...current, keyword]);
  };

  return (
    <div className="space-y-6">
      <section className="border border-aegis-border bg-aegis-bg-panel p-5">
        <div className="flex items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center border border-aegis-primary/35 bg-aegis-primary/[0.08] text-aegis-primary">
              <Radio size={18} />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-aegis-text">{t('settings.jarvisTitle')}</h2>
              <p className="mt-1 max-w-xl text-[12px] leading-5 text-aegis-text-dim">{t('settings.jarvisDescription')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { void settings.refresh(); }}
            disabled={settings.loading}
            className="grid size-9 shrink-0 place-items-center border border-aegis-border text-aegis-text-muted transition-colors hover:border-aegis-primary/45 hover:text-aegis-primary disabled:opacity-40"
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw size={16} className={settings.loading ? 'animate-spin motion-reduce:animate-none' : ''} />
          </button>
        </div>
      </section>

      <section className="border border-aegis-border bg-aegis-bg-panel p-5">
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-aegis-text">{t('settings.jarvisStandby')}</h3>
            <p className="mt-1 text-[12px] leading-5 text-aegis-text-dim">
              {settings.standbyEnabled ? t('settings.jarvisStandbyEnabled') : t('settings.jarvisStandbyDisabled')}
            </p>
            {settings.standbySessionKey && (
              <p className="mt-3 break-all font-mono text-[11px] text-aegis-text-secondary">{settings.standbySessionKey}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => { void settings.toggleStandby(); }}
            className={settings.standbyEnabled
              ? 'inline-flex h-9 shrink-0 items-center gap-2 border border-aegis-danger/45 px-3 text-[12px] font-semibold text-aegis-danger transition-colors hover:bg-aegis-danger/[0.08]'
              : 'inline-flex h-9 shrink-0 items-center gap-2 border border-aegis-primary/45 bg-aegis-primary/[0.08] px-3 text-[12px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.14]'}
          >
            <Power size={15} />
            {settings.standbyEnabled ? t('settings.jarvisStandbyStop') : t('settings.jarvisStandbyStart')}
          </button>
        </div>
      </section>

      <section className="border border-aegis-border bg-aegis-bg-panel p-5">
        <div className="flex items-center justify-between gap-5">
          <div>
            <h3 className="text-[13px] font-semibold text-aegis-text">{t('settings.jarvisModel')}</h3>
            <p className="mt-1 text-[12px] leading-5 text-aegis-text-dim">
              {settings.detector?.available ? t('settings.jarvisModelReady') : t('settings.jarvisModelRequired')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void settings.configureModel(t('input.voiceWakeChooseModelDirectory')); }}
            disabled={settings.configuring}
            className="inline-flex h-9 shrink-0 items-center gap-2 border border-aegis-primary/45 bg-aegis-primary/[0.08] px-3 text-[12px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/[0.14] disabled:opacity-40"
          >
            <FolderOpen size={15} />
            {settings.configuring ? t('input.voiceWakeCheckingModel') : t('settings.jarvisChooseModel')}
          </button>
        </div>
        {settings.detector?.directory && (
          <p className="mt-4 break-all border-s-2 border-aegis-primary/60 bg-aegis-primary/[0.035] px-3 py-2 font-mono text-[11px] text-aegis-text-secondary">
            {settings.detector.directory}
          </p>
        )}
      </section>

      <section className="border border-aegis-border bg-aegis-bg-panel p-5">
        <div>
          <h3 className="text-[13px] font-semibold text-aegis-text">{t('settings.jarvisWakePhrases')}</h3>
          <p className="mt-1 text-[12px] leading-5 text-aegis-text-dim">{t('settings.jarvisWakePhrasesHint')}</p>
        </div>
        {settings.detector?.available ? (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {settings.detector.keywords.map((keyword) => (
                <label key={keyword} className="flex min-w-0 items-center gap-2 border border-aegis-border px-3 py-2 text-[12px] text-aegis-text-secondary">
                  <input
                    type="checkbox"
                    checked={draftKeywords.includes(keyword)}
                    onChange={() => toggleKeyword(keyword)}
                    className="size-3.5 shrink-0 accent-[rgb(var(--aegis-primary))]"
                  />
                  <span className="truncate">{keyword}</span>
                </label>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  void settings.saveKeywords(
                    draftKeywords,
                    t('input.voiceWakePhraseSelectionInvalid'),
                    t('input.voiceWakeTriggerCapacityExceeded'),
                  );
                }}
                disabled={settings.saving || draftKeywords.length === 0}
                className="inline-flex h-9 items-center gap-2 bg-aegis-primary px-3 text-[12px] font-semibold text-white transition-colors hover:bg-aegis-primary/85 disabled:opacity-40"
              >
                <Check size={15} />
                {t('input.voiceWakeSavePhrases')}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-4 flex items-center gap-2 border border-aegis-border bg-aegis-bg-muted px-3 py-3 text-[12px] text-aegis-text-dim">
            <TriangleAlert size={15} className="shrink-0 text-aegis-warning" />
            {t('settings.jarvisModelRequired')}
          </div>
        )}
      </section>

      {settings.error && (
        <p role="alert" className="border-s-2 border-aegis-danger bg-aegis-danger/[0.06] px-3 py-2 text-[12px] leading-5 text-aegis-danger">
          {settings.error}
        </p>
      )}
    </div>
  );
}
