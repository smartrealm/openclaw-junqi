import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Icon } from '@/components/shared/icons';
import { getProviderDisplayLabel } from '@/components/shared/ModelDropdown';
import { useChatStore } from '@/stores/chatStore';
import {
  groupSessionModels,
  modelDisplayName,
  modelProviderId,
  SESSION_THINKING_LEVELS,
  type SessionThinkingLevel,
} from './sessionRuntimeDomain';
import { useSessionRuntimeSettings } from './useSessionRuntimeSettings';

function ProviderIcon({ providerId }: { providerId: string }) {
  return <>{(Icon.provider[providerId] ?? Icon.provider.other).icon}</>;
}

export function SessionRuntimeControl() {
  const { t } = useTranslation();
  const availableModels = useChatStore((state) => state.availableModels);
  const { activeSessionKey, committed, saving, apply } = useSessionRuntimeSettings();
  const [open, setOpen] = useState(false);
  const [draftModelId, setDraftModelId] = useState<string | null>(committed.modelId);
  const [draftThinking, setDraftThinking] = useState<SessionThinkingLevel>(committed.thinking);
  const [providerId, setProviderId] = useState(() => committed.modelId ? modelProviderId(committed.modelId) : '');
  const rootRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupSessionModels(availableModels), [availableModels]);
  const activeModel = availableModels.find((model) => model.id === committed.modelId);
  const draftModel = availableModels.find((model) => model.id === draftModelId);
  const selectedGroup = groups.find((group) => group.providerId === providerId) ?? groups[0];
  const hasChanges = draftModelId !== committed.modelId || draftThinking !== committed.thinking;

  useEffect(() => {
    if (open) return;
    setDraftModelId(committed.modelId);
    setDraftThinking(committed.thinking);
    setProviderId(committed.modelId ? modelProviderId(committed.modelId) : (groups[0]?.providerId ?? ''));
  }, [committed.modelId, committed.thinking, groups, open]);

  useEffect(() => {
    setOpen(false);
  }, [activeSessionKey]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!saving && !rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, saving]);

  if (availableModels.length === 0) return null;

  const modelLabel = modelDisplayName(activeModel, committed.modelId) || t('config.notSet');
  const thinkingLabel = t(`titlebar.thinking.levels.${committed.thinking}`);
  const draftProviderLabel = draftModelId
    ? getProviderDisplayLabel(modelProviderId(draftModelId))
    : t('config.notSet');

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => { if (!saving) setOpen((value) => !value); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-md px-2 text-[11px] text-aegis-text-muted transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
        title={t('input.sessionRuntimeSummary', { model: modelLabel, thinking: thinkingLabel })}
      >
        <span className="truncate font-mono">{modelLabel}</span>
        <span aria-hidden className="text-aegis-text-dim">·</span>
        <span className="shrink-0">{thinkingLabel}</span>
        <span className="grid size-3 shrink-0 place-items-center">
          {saving
            ? <LoaderCircle size={11} className="animate-spin" />
            : <ChevronDown size={11} className={clsx('transition-transform', open && 'rotate-180')} />}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('input.sessionRuntimeTitle')}
          className="absolute bottom-full end-0 z-50 mb-2 flex w-[min(620px,calc(100vw-32px))] max-h-[min(520px,70vh)] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(96px,0.8fr)_minmax(0,1.7fr)]">
            <div className="overflow-y-auto border-e border-aegis-menu-border p-2">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeProvider')}
              </div>
              {groups.map((group) => (
                <button
                  key={group.providerId}
                  type="button"
                  onClick={() => setProviderId(group.providerId)}
                  className={clsx(
                    'flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-start text-[12px] transition-colors',
                    selectedGroup?.providerId === group.providerId
                      ? 'bg-[rgb(var(--aegis-primary)/0.09)] text-aegis-primary'
                      : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                  )}
                >
                  <span className="shrink-0"><ProviderIcon providerId={group.providerId} /></span>
                  <span className="truncate">{getProviderDisplayLabel(group.providerId)}</span>
                </button>
              ))}
            </div>

            <div className="min-h-0 overflow-y-auto p-2">
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeModel')}
              </div>
              {selectedGroup?.models.map((model) => {
                const selected = model.id === draftModelId;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setDraftModelId(model.id)}
                    disabled={selected}
                    aria-current={selected ? 'true' : undefined}
                    className={clsx(
                      'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start transition-colors',
                      selected
                        ? 'cursor-default bg-[rgb(var(--aegis-primary)/0.08)] text-aegis-primary'
                        : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium">
                        {modelDisplayName(model, model.id)}
                      </span>
                      {(model.alias || model.label) && (
                        <span className="block truncate font-mono text-[10px] text-aegis-text-dim">{model.id}</span>
                      )}
                    </span>
                    {selected && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-aegis-menu-border px-3 py-2.5">
            <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
              {t('titlebar.thinking.label')}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {SESSION_THINKING_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDraftThinking(level)}
                  disabled={draftThinking === level}
                  aria-current={draftThinking === level ? 'true' : undefined}
                  className={clsx(
                    'h-8 rounded-md border px-2 text-[11px] transition-colors',
                    draftThinking === level
                      ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                      : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                  )}
                >
                  {t(`titlebar.thinking.levels.${level}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0 truncate text-[10px] text-aegis-text-dim">
              {t('input.sessionRuntimeDraft', {
                provider: draftProviderLabel,
                model: modelDisplayName(draftModel, draftModelId),
              })}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="h-8 rounded-md border border-aegis-border px-3 text-[11px] text-aegis-text-muted transition-colors hover:border-aegis-border-hover hover:text-aegis-text disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void apply({ modelId: draftModelId, thinking: draftThinking })
                    .then((updated) => { if (updated) setOpen(false); });
                }}
                disabled={!draftModelId || !hasChanges || saving}
                className="inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[11px] font-medium text-white transition-colors hover:bg-aegis-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {saving && <LoaderCircle size={12} className="animate-spin" />}
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
