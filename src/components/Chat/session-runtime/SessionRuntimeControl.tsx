import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, Lock, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ProviderIcon, providerDisplayLabel } from '@/components/shared/provider-identity';
import { useChatStore } from '@/stores/chatStore';
import {
  groupSessionModels,
  modelDisplayName,
  modelProviderId,
  canChangeSessionModel,
  SESSION_FAST_MODES,
  SESSION_REASONING_LEVELS,
  SESSION_RESPONSE_USAGE_LEVELS,
  SESSION_TRACE_LEVELS,
  SESSION_VERBOSE_LEVELS,
  type SessionFastMode,
  type SessionReasoningLevel,
  type SessionResponseUsageLevel,
  type SessionTraceLevel,
  type SessionVerboseLevel,
} from '@/processing/sessionRuntimeDomain';
import { useSessionRuntimeSettings } from '@/hooks/chat/useSessionRuntimeSettings';

const EMPTY_MODELS: ReadonlyArray<{ id: string; label: string; alias?: string }> = [];

export function SessionRuntimeControl() {
  const { t } = useTranslation();
  const activeSessionAgentId = useChatStore((state) => (
    state.sessions.find((session) => session.key === state.activeSessionKey)?.agentId?.trim() ?? ''
  ));
  const availableModels = useChatStore((state) => (
    activeSessionAgentId
      ? state.sessionAvailableModelsByAgentId[activeSessionAgentId] ?? EMPTY_MODELS
      : EMPTY_MODELS
  ));
  const {
    activeSessionKey,
    committed,
    modelSelectionLocked,
    saving,
    apply,
    restoreDefaultModel,
  } = useSessionRuntimeSettings();
  const [open, setOpen] = useState(false);
  const [draftModelId, setDraftModelId] = useState<string | null>(committed.modelId);
  const [draftThinking, setDraftThinking] = useState<string | null>(committed.thinking);
  const [draftFastMode, setDraftFastMode] = useState<SessionFastMode>(committed.fastMode);
  const [draftVerbose, setDraftVerbose] = useState<SessionVerboseLevel>(committed.verbose);
  const [draftTrace, setDraftTrace] = useState<SessionTraceLevel>(committed.trace);
  const [draftResponseUsage, setDraftResponseUsage] = useState<SessionResponseUsageLevel>(committed.responseUsage);
  const [draftReasoning, setDraftReasoning] = useState<SessionReasoningLevel>(committed.reasoning);
  const [providerId, setProviderId] = useState(() => committed.modelId ? modelProviderId(committed.modelId) : '');
  const rootRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => groupSessionModels(availableModels), [availableModels]);
  const activeModel = availableModels.find((model) => model.id === committed.modelId);
  const selectedGroup = groups.find((group) => group.providerId === providerId) ?? groups[0];
  const hasChanges = draftModelId !== committed.modelId
    || draftThinking !== committed.thinking
    || draftFastMode !== committed.fastMode
    || draftVerbose !== committed.verbose
    || draftTrace !== committed.trace
    || draftResponseUsage !== committed.responseUsage
    || draftReasoning !== committed.reasoning;
  const requiresThinkingProfileRefresh = draftModelId !== committed.modelId
    && draftThinking !== committed.thinking;

  useEffect(() => {
    if (open) return;
    setDraftModelId(committed.modelId);
    setDraftThinking(committed.thinking);
    setDraftFastMode(committed.fastMode);
    setDraftVerbose(committed.verbose);
    setDraftTrace(committed.trace);
    setDraftResponseUsage(committed.responseUsage);
    setDraftReasoning(committed.reasoning);
    setProviderId(committed.modelId ? modelProviderId(committed.modelId) : (groups[0]?.providerId ?? ''));
  }, [committed.fastMode, committed.modelId, committed.reasoning, committed.responseUsage, committed.thinking, committed.trace, committed.verbose, groups, open]);

  useEffect(() => {
    if (modelSelectionLocked) setDraftModelId(committed.modelId);
  }, [committed.modelId, modelSelectionLocked]);

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
  const thinkingOptions = committed.thinkingLevels ?? [];
  const thinkingOptionLabel = (level: string | null): string => {
    if (level === null) {
      const defaultOption = thinkingOptions.find((option) => option.id === committed.thinkingDefault);
      return defaultOption
        ? t('input.sessionRuntimeThinkingInherited', { level: defaultOption.label })
        : t('input.sessionRuntimeThinkingInherit');
    }
    return thinkingOptions.find((option) => option.id === level)?.label ?? level;
  };
  const thinkingLabel = thinkingOptionLabel(committed.thinking);
  const fastModeLabel = t(`input.sessionRuntimeFastModes.${committed.fastMode}`);
  const verboseLabel = t(`input.sessionRuntimeVerboseModes.${committed.verbose}`);
  const traceLabel = t(`input.sessionRuntimeTraceModes.${committed.trace}`);
  const responseUsageLabel = t(`input.sessionRuntimeResponseUsageModes.${committed.responseUsage}`);
  const reasoningLabel = t(`input.sessionRuntimeReasoningModes.${committed.reasoning}`);
  const committedProviderId = committed.modelId ? modelProviderId(committed.modelId) : 'other';
  const canSelectModel = canChangeSessionModel(modelSelectionLocked);
  return (
    <div ref={rootRef} className="relative min-w-0 no-drag">
      <button
        type="button"
        onClick={() => { if (!saving) setOpen((value) => !value); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex h-7 max-w-[280px] items-center gap-1.5 rounded-md px-1.5 text-[11px] text-aegis-text-muted transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
        title={t('input.sessionRuntimeSummary', {
          model: modelLabel,
          thinking: thinkingLabel,
          fastMode: fastModeLabel,
          verbose: verboseLabel,
          trace: traceLabel,
          responseUsage: responseUsageLabel,
          reasoning: reasoningLabel,
        })}
      >
        <ProviderIcon providerId={committedProviderId} size={14} className="text-aegis-text-dim" />
        <span className="min-w-0 truncate font-mono">{modelLabel}</span>
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
          className="absolute top-full start-0 z-50 mt-2 flex w-[min(420px,calc(100vw-24px))] max-h-[min(460px,calc(100vh-96px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid min-h-[132px] max-h-[236px] grid-cols-[136px_minmax(0,1fr)] overflow-hidden">
              <div className="overflow-y-auto border-e border-aegis-menu-border p-1.5">
                <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase text-aegis-text-dim">
                  {t('input.sessionRuntimeProvider')}
                </div>
                {groups.map((group) => (
                  <button
                    key={group.providerId}
                    type="button"
                    onClick={() => setProviderId(group.providerId)}
                    className={clsx(
                      'flex min-h-8 w-full items-center gap-1.5 rounded-md border border-transparent px-1.5 text-start text-[12px] font-medium transition-colors',
                      selectedGroup?.providerId === group.providerId
                        ? 'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.055)] text-aegis-text'
                        : 'text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]',
                    )}
                  >
                    <ProviderIcon providerId={group.providerId} size={16} className="text-aegis-text-muted" />
                    <span className="truncate">{providerDisplayLabel(group.providerId)}</span>
                  </button>
                ))}
              </div>

              <div className="min-h-0 overflow-y-auto p-2">
                <div className="px-1 pb-1 text-[10px] font-semibold uppercase text-aegis-text-dim">
                  <span className="inline-flex items-center gap-1">
                    {t('input.sessionRuntimeModel')}
                    {modelSelectionLocked && (
                      <span
                        role="img"
                        aria-label={t('input.sessionRuntimeModelSelectionLocked')}
                        title={t('input.sessionRuntimeModelSelectionLocked')}
                      >
                        <Lock size={11} aria-hidden="true" />
                      </span>
                    )}
                  </span>
                </div>
                {selectedGroup?.models.map((model) => {
                  const selected = model.id === draftModelId;
                  const disabled = selected || !canSelectModel;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => setDraftModelId(model.id)}
                      disabled={disabled}
                      aria-current={selected ? 'true' : undefined}
                      title={!canSelectModel ? t('input.sessionRuntimeModelSelectionLocked') : undefined}
                      className={clsx(
                        'flex min-h-11 w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                        selected
                          ? 'cursor-default border-aegis-border bg-[rgb(var(--aegis-overlay)/0.055)] text-aegis-text'
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
              {thinkingOptions.length === 0 ? (
                <div role="status" className="text-[11px] text-aegis-warning">
                  {t('input.sessionRuntimeThinkingUnavailable')}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  <button
                    type="button"
                    onClick={() => setDraftThinking(null)}
                    disabled={draftThinking === null}
                    aria-current={draftThinking === null ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftThinking === null
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    <span className="block truncate">{thinkingOptionLabel(null)}</span>
                  </button>
                  {thinkingOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDraftThinking(option.id)}
                      disabled={draftThinking === option.id}
                      aria-current={draftThinking === option.id ? 'true' : undefined}
                      className={clsx(
                        'h-8 min-w-0 rounded-md border px-2 text-[11px] transition-colors',
                        draftThinking === option.id
                          ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                          : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                      )}
                      title={option.label}
                    >
                      <span className="block truncate">{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {requiresThinkingProfileRefresh && (
                <div role="status" className="mt-2 text-[11px] text-aegis-warning">
                  {t('input.sessionRuntimeThinkingModelChange')}
                </div>
              )}
            </div>

            <div className="border-t border-aegis-menu-border px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeFastMode')}
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SESSION_FAST_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setDraftFastMode(mode)}
                    disabled={draftFastMode === mode}
                    aria-current={draftFastMode === mode ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftFastMode === mode
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    {t(`input.sessionRuntimeFastModes.${mode}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-aegis-menu-border px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeVerbose')}
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SESSION_VERBOSE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDraftVerbose(level)}
                    disabled={draftVerbose === level}
                    aria-current={draftVerbose === level ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftVerbose === level
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    {t(`input.sessionRuntimeVerboseModes.${level}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-aegis-menu-border px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeTrace')}
              </div>
              {draftTrace === 'unsupported' && (
                <div role="status" className="mb-2 text-[11px] text-aegis-warning">
                  {t('input.sessionRuntimeTraceUnsupported')}
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {SESSION_TRACE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDraftTrace(level)}
                    disabled={draftTrace === level}
                    aria-current={draftTrace === level ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftTrace === level
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    {t(`input.sessionRuntimeTraceModes.${level}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-aegis-menu-border px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeReasoning')}
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SESSION_REASONING_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDraftReasoning(level)}
                    disabled={draftReasoning === level}
                    aria-current={draftReasoning === level ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftReasoning === level
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    {t(`input.sessionRuntimeReasoningModes.${level}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-aegis-menu-border px-3 py-2.5">
              <div className="mb-2 text-[10px] font-semibold uppercase text-aegis-text-dim">
                {t('input.sessionRuntimeResponseUsage')}
              </div>
              {draftResponseUsage === 'unsupported' && (
                <div role="status" className="mb-2 text-[11px] text-aegis-warning">
                  {t('input.sessionRuntimeResponseUsageUnsupported')}
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SESSION_RESPONSE_USAGE_LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setDraftResponseUsage(level)}
                    disabled={draftResponseUsage === level}
                    aria-current={draftResponseUsage === level ? 'true' : undefined}
                    className={clsx(
                      'h-8 rounded-md border px-2 text-[11px] transition-colors',
                      draftResponseUsage === level
                        ? 'cursor-default border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
                        : 'border-aegis-border text-aegis-text-muted hover:border-aegis-border-hover hover:text-aegis-text',
                    )}
                  >
                    {t(`input.sessionRuntimeResponseUsageModes.${level}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-aegis-menu-border px-3 py-2.5">
            <button
              type="button"
              onClick={() => {
                void restoreDefaultModel()
                  .then((updated) => { if (updated) setOpen(false); });
              }}
              disabled={saving || !canSelectModel}
              title={!canSelectModel
                ? t('input.sessionRuntimeModelSelectionLocked')
                : t('input.useDefaultModelHint')}
              className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[11px] text-aegis-text-muted transition-colors hover:border-aegis-border-hover hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-45"
            >
              <RotateCcw size={12} className="shrink-0" />
              <span className="truncate">{t('input.useDefaultModel')}</span>
            </button>
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
                  void apply({
                    modelId: draftModelId,
                    thinking: draftThinking,
                    fastMode: draftFastMode,
                    verbose: draftVerbose,
                    trace: draftTrace,
                    responseUsage: draftResponseUsage,
                    reasoning: draftReasoning,
                  })
                    .then((updated) => { if (updated) setOpen(false); });
                }}
                disabled={!draftModelId || !hasChanges || saving || requiresThinkingProfileRefresh}
                className="inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[11px] font-medium text-aegis-btn-primary-text transition-colors hover:bg-aegis-primary-hover disabled:cursor-not-allowed disabled:opacity-45"
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
