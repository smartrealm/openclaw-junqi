import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  KeyRound,
  MessageCircleQuestion,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import clsx from 'clsx';
import { Button, IconButton } from '@/components/shared/button';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import type {
  OpenClawPendingQuestion,
  OpenClawQuestionAnswers,
} from '@/services/gateway/OpenClawQuestionClient';
import { useOpenClawQuestionsStore } from '@/stores/openclawQuestionsStore';
import {
  buildOpenClawQuestionAnswers,
  normalizeOpenClawQuestionAllowedHosts,
  openClawQuestionHasAnswer,
} from './openClawQuestionAnswers';

export function ChatQuestionCard({
  prompt,
  requestPosition,
  resolving,
  error,
  onSubmit,
  onCancel,
  onPreviousRequest,
  onNextRequest,
  onExpired,
  collapsed,
  onCollapsedChange,
}: {
  readonly prompt: OpenClawPendingQuestion;
  readonly requestPosition: { readonly current: number; readonly total: number };
  readonly resolving: boolean;
  readonly error: string | null;
  readonly onSubmit: (
    answers: OpenClawQuestionAnswers,
    allowedHosts?: readonly string[],
  ) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly onPreviousRequest: () => void;
  readonly onNextRequest: () => void;
  readonly onExpired: () => void;
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selected, setSelected] = useState<Record<string, readonly string[]>>({});
  const [freeText, setFreeText] = useState<Record<string, string>>({});
  const [allowedHosts, setAllowedHosts] = useState(
    prompt.questions[0]?.secretStore?.allowedHosts?.join(', ') ?? '',
  );
  const [expired, setExpired] = useState(() => prompt.expiresAtMs <= Date.now());
  const panelRef = useRef<HTMLElement>(null);
  const question = prompt.questions[questionIndex];

  useEffect(() => {
    const remaining = prompt.expiresAtMs - Date.now();
    if (remaining <= 0) {
      setExpired(true);
      onExpired();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setExpired(true);
      onExpired();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [onExpired, prompt.expiresAtMs]);

  const answers = useMemo(
    () => buildOpenClawQuestionAnswers(prompt, selected, freeText),
    [freeText, prompt, selected],
  );
  if (!question) return null;

  const disabled = resolving || expired;
  const isLast = questionIndex === prompt.questions.length - 1;
  const canAdvance = openClawQuestionHasAnswer(question, selected, freeText);
  const allAnswered = prompt.questions.every((candidate) => (
    openClawQuestionHasAnswer(candidate, selected, freeText)
  ));

  const chooseOption = (label: string, advanceAfterSelection = true) => {
    if (disabled) return;
    setSelected((current) => {
      const values = current[question.questionId] ?? [];
      return {
        ...current,
        [question.questionId]: question.multiSelect
          ? values.includes(label)
            ? values.filter((value) => value !== label)
            : [...values, label]
          : [label],
      };
    });
    if (!question.multiSelect) {
      setFreeText((current) => ({ ...current, [question.questionId]: '' }));
      if (advanceAfterSelection && !isLast) setQuestionIndex((current) => current + 1);
    }
  };

  const updateFreeText = (value: string) => {
    setFreeText((current) => ({ ...current, [question.questionId]: value }));
    if (!question.multiSelect && (question.isSecret ? value : value.trim())) {
      setSelected((current) => ({ ...current, [question.questionId]: [] }));
    }
  };

  const advance = () => {
    if (!canAdvance || disabled) return;
    if (!isLast) {
      setQuestionIndex((current) => current + 1);
      return;
    }
    if (allAnswered) {
      void onSubmit(
        answers,
        question.secretStore
          ? normalizeOpenClawQuestionAllowedHosts(allowedHosts)
          : undefined,
      );
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (disabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Enter' && canAdvance) {
        event.preventDefault();
        advance();
      }
      return;
    }
    const currentOptionIndex = event.target instanceof HTMLButtonElement
      ? Number(event.target.dataset.optionIndex)
      : Number.NaN;
    if (
      !question.multiSelect
      && Number.isInteger(currentOptionIndex)
      && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    ) {
      event.preventDefault();
      const lastIndex = question.options.length - 1;
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? lastIndex
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? (currentOptionIndex - 1 + question.options.length) % question.options.length
            : (currentOptionIndex + 1) % question.options.length;
      const nextOption = question.options[nextIndex];
      if (!nextOption) return;
      chooseOption(nextOption.label, false);
      window.requestAnimationFrame(() => {
        panelRef.current
          ?.querySelector<HTMLButtonElement>(`[data-option-index="${nextIndex}"]`)
          ?.focus({ preventScroll: true });
      });
      return;
    }
    const optionIndex = Number(event.key) - 1;
    const option = question.options[optionIndex];
    if (optionIndex >= 0 && optionIndex < question.options.length && option) {
      event.preventDefault();
      chooseOption(option.label);
    }
  };

  const existingUpdatedAt = question.secretStoreExisting
    ? formatQuestionTimestamp(question.secretStoreExisting.updatedAtMs, i18n.language)
    : null;

  if (collapsed) {
    return (
      <section
        className="flex min-h-11 items-center rounded-xl border border-aegis-border bg-aegis-card px-2 shadow-popover"
        aria-label={t('chat.questions.ariaLabel')}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-start text-aegis-text transition-colors hover:bg-aegis-hover/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40"
          aria-label={t('chat.questions.expand')}
          onClick={() => onCollapsedChange(false)}
        >
          <MessageCircleQuestion size={15} className="shrink-0 text-aegis-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{question.header}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-aegis-text-dim">
            {questionIndex + 1}/{prompt.questions.length}
          </span>
          <ChevronDown size={14} className="shrink-0 text-aegis-text-dim" aria-hidden="true" />
        </button>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      data-openclaw-question-card="true"
      className="chat-scrollbar max-h-[min(58vh,36rem)] overflow-y-auto overscroll-contain rounded-xl border border-aegis-border bg-aegis-card shadow-popover motion-safe:animate-fade-in"
      role="group"
      tabIndex={0}
      aria-label={t('chat.questions.ariaLabel')}
      onKeyDown={handleKeyDown}
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-aegis-border px-3 py-2">
        <MessageCircleQuestion size={16} className="shrink-0 text-aegis-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-aegis-text">
            {t('chat.questions.title')}
          </p>
          <p className="truncate text-[9px] text-aegis-text-dim">
            {prompt.agentId
              ? t('chat.questions.requestedBy', { agent: prompt.agentId })
              : t('chat.questions.openClawSource')}
          </p>
        </div>
        {requestPosition.total > 1 && (
          <div className="flex items-center gap-0.5 text-[10px] tabular-nums text-aegis-text-dim">
            <IconButton
              size="xs"
              variant="plain"
              aria-label={t('chat.questions.previousRequest')}
              onClick={onPreviousRequest}
            >
              <ChevronLeft size={14} />
            </IconButton>
            <span className="min-w-8 text-center">
              {requestPosition.current}/{requestPosition.total}
            </span>
            <IconButton
              size="xs"
              variant="plain"
              aria-label={t('chat.questions.nextRequest')}
              onClick={onNextRequest}
            >
              <ChevronRight size={14} />
            </IconButton>
          </div>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-aegis-text-dim">
          {questionIndex + 1}/{prompt.questions.length}
        </span>
        <IconButton
          size="xs"
          variant="plain"
          aria-label={t('chat.questions.collapse')}
          onClick={() => onCollapsedChange(true)}
        >
          <ChevronDown size={14} />
        </IconButton>
      </header>

      <div className="space-y-3 p-3">
        <div>
          <span className="inline-flex rounded-md bg-aegis-primary/10 px-2 py-0.5 text-[9px] font-medium text-aegis-primary">
            {question.header}
          </span>
          <h3 className="mt-2 break-words text-[13px] font-semibold leading-5 text-aegis-text">
            {question.question}
          </h3>
        </div>

        <div
          className="grid gap-1.5"
          role={question.multiSelect ? 'group' : 'radiogroup'}
          aria-label={question.header}
        >
          {question.options.map((option, index) => {
            const checked = selected[question.questionId]?.includes(option.label) ?? false;
            return (
              <button
                key={option.label}
                type="button"
                role={question.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={checked}
                data-option-index={index}
                tabIndex={question.multiSelect || checked || (
                  !(selected[question.questionId]?.length) && index === 0
                ) ? 0 : -1}
                disabled={disabled}
                onClick={() => chooseOption(option.label)}
                className={clsx(
                  'grid w-full grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-2 rounded-lg border px-2.5 py-2 text-start transition-[background-color,border-color,color] duration-[var(--aegis-duration-fast)] ease-[var(--aegis-ease-standard)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
                  checked
                    ? 'border-aegis-primary/45 bg-aegis-primary/10 text-aegis-text'
                    : 'border-aegis-border bg-aegis-surface text-aegis-text-secondary hover:border-aegis-primary/30 hover:bg-aegis-hover/35',
                )}
              >
                <span
                  aria-hidden="true"
                  className={clsx(
                    'grid size-4 place-items-center border border-aegis-border',
                    question.multiSelect ? 'rounded' : 'rounded-full',
                    checked && 'border-aegis-primary',
                  )}
                >
                  {checked && <span className={clsx(
                    'bg-aegis-primary',
                    question.multiSelect ? 'size-2 rounded-sm' : 'size-1.5 rounded-full',
                  )} />}
                </span>
                <span className="min-w-0">
                  <strong className="block break-words text-[11px] font-medium leading-4">
                    {option.label}
                  </strong>
                  {option.description && (
                    <small className="mt-0.5 block break-words text-[9px] leading-4 text-aegis-text-dim">
                      {option.description}
                    </small>
                  )}
                </span>
                <kbd className="text-center font-mono text-[9px] text-aegis-text-dim">
                  {index + 1}
                </kbd>
              </button>
            );
          })}
        </div>

        {(question.isOther || question.options.length === 0) && (
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium text-aegis-text-secondary">
              {question.isSecret ? t('chat.questions.secretValue') : t('chat.questions.customAnswer')}
            </span>
            <input
              type={question.isSecret ? 'password' : 'text'}
              value={freeText[question.questionId] ?? ''}
              disabled={disabled}
              autoComplete="off"
              onChange={(event) => updateFreeText(event.target.value)}
              aria-label={t('chat.questions.answerFor', { header: question.header })}
              className="h-9 w-full rounded-lg border border-aegis-border bg-aegis-surface px-3 text-[12px] text-aegis-text outline-none transition-[border-color,box-shadow] duration-[var(--aegis-duration-fast)] ease-[var(--aegis-ease-standard)] placeholder:text-aegis-text-dim focus:border-aegis-primary/45 focus:ring-2 focus:ring-aegis-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t('chat.questions.customAnswerPlaceholder')}
            />
          </label>
        )}

        {question.secretStore && (
          <div className="space-y-2 rounded-lg border border-aegis-warning/25 bg-aegis-warning/[0.05] p-2.5 text-[10px] leading-4 text-aegis-text-muted">
            <div className="flex items-start gap-2">
              <KeyRound size={14} className="mt-0.5 shrink-0 text-aegis-warning" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-aegis-text">
                  {t('chat.questions.secretStoreTarget', { name: question.secretStore.name })}
                </p>
                {question.secretStore.reason && <p className="mt-0.5">{question.secretStore.reason}</p>}
                {existingUpdatedAt && (
                  <p className="mt-0.5 text-aegis-warning">
                    {t('chat.questions.secretStoreReplace', { time: existingUpdatedAt })}
                  </p>
                )}
              </div>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-aegis-text-secondary">
                {t('chat.questions.allowedHosts')}
              </span>
              <input
                type="text"
                value={allowedHosts}
                disabled={disabled}
                autoComplete="off"
                onChange={(event) => setAllowedHosts(event.target.value)}
                className="h-8 w-full rounded-md border border-aegis-border bg-aegis-surface px-2.5 text-[10px] text-aegis-text outline-none focus:border-aegis-primary/45 focus:ring-2 focus:ring-aegis-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                placeholder={t('chat.questions.allowedHostsPlaceholder')}
              />
            </label>
          </div>
        )}

        {expired && (
          <p role="status" className="text-[10px] text-aegis-warning">
            {t('chat.questions.expired')}
          </p>
        )}
        {error && (
          <p role="alert" className="break-words text-[10px] leading-4 text-aegis-danger">
            {t('chat.questions.failed', { error })}
          </p>
        )}

        <footer className="flex min-h-8 flex-wrap items-center justify-end gap-2 border-t border-aegis-border pt-3">
          {questionIndex > 0 && (
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
              className="me-auto"
            >
              {t('chat.questions.back')}
            </Button>
          )}
          <Button
            data-question-action="cancel"
            size="xs"
            variant="ghost"
            disabled={disabled}
            onClick={() => void onCancel()}
          >
            {t('chat.questions.skip')}
          </Button>
          <Button
            data-question-action="submit"
            size="xs"
            variant="solid"
            tone="primary"
            disabled={disabled || !canAdvance || (isLast && !allAnswered)}
            onClick={advance}
          >
            {resolving && <LoadingIndicator size={12} />}
            {isLast ? t('chat.questions.submit') : t('chat.questions.next')}
          </Button>
        </footer>
      </div>
    </section>
  );
}

export function ChatQuestionDock({
  connected,
  activeSessionKey,
  onExpandedChange,
}: {
  readonly connected: boolean;
  readonly activeSessionKey: string;
  readonly onExpandedChange?: (expanded: boolean) => void;
}) {
  const {
    questions,
    error,
    errorRequestId,
    resolvingId,
    refresh,
    subscribeLiveUpdates,
    resolve,
    cancel,
  } = useOpenClawQuestionsStore(useShallow((state) => ({
    questions: state.questions,
    error: state.error,
    errorRequestId: state.errorRequestId,
    resolvingId: state.resolvingId,
    refresh: state.refresh,
    subscribeLiveUpdates: state.subscribeLiveUpdates,
    resolve: state.resolve,
    cancel: state.cancel,
  })));
  const visibleQuestions = useMemo(() => questions.filter((question) => (
    !question.sessionKey || question.sessionKey === activeSessionKey
  )), [activeSessionKey, questions]);
  const [requestIndex, setRequestIndex] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const handleExpired = useCallback(() => {
    void refresh(connected, false);
  }, [connected, refresh]);

  useEffect(() => {
    const release = subscribeLiveUpdates(connected);
    void refresh(connected, false);
    return release;
  }, [connected, refresh, subscribeLiveUpdates]);

  useEffect(() => {
    setRequestIndex((current) => Math.min(current, Math.max(0, visibleQuestions.length - 1)));
  }, [visibleQuestions.length]);

  const prompt = visibleQuestions[requestIndex];

  useEffect(() => {
    setCollapsed(false);
  }, [prompt?.id]);

  useEffect(() => {
    onExpandedChange?.(Boolean(connected && prompt && !collapsed));
    return () => onExpandedChange?.(false);
  }, [collapsed, connected, onExpandedChange, prompt]);

  if (!connected || !prompt) return null;

  return (
    <div className="shrink-0 bg-[var(--aegis-bg-frosted-60)] px-3 pt-3 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-[760px]">
        {visibleQuestions.map((candidate, index) => (
          <div key={candidate.id} hidden={index !== requestIndex}>
            <ChatQuestionCard
              prompt={candidate}
              requestPosition={{ current: index + 1, total: visibleQuestions.length }}
              resolving={resolvingId === candidate.id}
              error={errorRequestId === null || errorRequestId === candidate.id ? error : null}
              onSubmit={(answers, allowedHosts) => resolve(
                connected,
                candidate.id,
                answers,
                allowedHosts,
              )}
              onCancel={() => cancel(connected, candidate.id)}
              onPreviousRequest={() => setRequestIndex((current) => (
                (current - 1 + visibleQuestions.length) % visibleQuestions.length
              ))}
              onNextRequest={() => setRequestIndex((current) => (
                (current + 1) % visibleQuestions.length
              ))}
              onExpired={handleExpired}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function formatQuestionTimestamp(timestamp: number, language: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}
