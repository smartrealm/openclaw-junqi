import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ArrowRight, CheckCircle2, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AGENT_GUIDE_STEPS,
  CHANNEL_GUIDE_STEPS,
  FIRST_RESPONSE_GUIDE_STEPS,
  type BusinessGuideStepDefinition,
} from '@/business-guide/steps';
import { findNewUserMessage, hasAssistantResponseAfter } from '@/business-guide/completion';
import { getCoachmarkPlacement, type CoachmarkSide } from '@/business-guide/placement';
import { useBusinessGuideActivation } from '@/hooks/useBusinessGuideActivation';
import { useBusinessGuideStore } from '@/stores/businessGuideStore';
import { useChatStore } from '@/stores/chatStore';
import { Button } from '@/components/shared/button';

type GuideTrack = 'first-response' | 'channel' | 'agent';

interface IntroStep {
  kind: 'intro';
  id: string;
  title: string;
  description: string;
}

interface OperationStep extends BusinessGuideStepDefinition {
  kind: 'operation';
  title: string;
  description: string;
  stateLabel?: string;
}

interface FinishStep {
  kind: 'finish';
  id: string;
  title: string;
  description: string;
}

type TourStep = IntroStep | OperationStep | FinishStep;

const TARGET_WAIT_MS = 8_000;
const TARGET_GUTTER = 6;
const DEFAULT_PANEL_SIZE = { width: 380, height: 280 };

function operationStep(
  definition: BusinessGuideStepDefinition,
  translate: (key: string) => string,
): OperationStep {
  return {
    ...definition,
    kind: 'operation',
    title: translate(definition.titleKey),
    description: translate(definition.descriptionKey),
    stateLabel: definition.stateKey ? translate(definition.stateKey) : undefined,
  };
}

function connectorClass(side: CoachmarkSide): string {
  if (side === 'bottom') return '-top-3 left-1/2 h-3 border-l';
  if (side === 'top') return '-bottom-3 left-1/2 h-3 border-l';
  if (side === 'right') return '-left-3 top-1/2 w-3 border-t';
  if (side === 'left') return '-right-3 top-1/2 w-3 border-t';
  return 'hidden';
}

export function BusinessGuide() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const welcomeDismissed = useBusinessGuideStore((state) => state.welcomeDismissed);
  const dismissWelcome = useBusinessGuideStore((state) => state.dismissWelcome);
  const tourOpen = useBusinessGuideStore((state) => state.tourOpen);
  const tourStartIndex = useBusinessGuideStore((state) => state.tourStartIndex);
  const openTour = useBusinessGuideStore((state) => state.openTour);
  const closeTour = useBusinessGuideStore((state) => state.closeTour);
  const active = useBusinessGuideActivation();
  const activeSessionKey = useChatStore((state) => state.activeSessionKey);
  const messages = useChatStore((state) => state.messages);
  const [track, setTrack] = useState<GuideTrack>('first-response');
  const [index, setIndex] = useState(0);
  const [targetElement, setTargetElement] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);
  const [targetAttempt, setTargetAttempt] = useState(0);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [panelSize, setPanelSize] = useState(DEFAULT_PANEL_SIZE);
  const [guidedUserMessageId, setGuidedUserMessageId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sessionBaselineRef = useRef('');
  const messageBaselineRef = useRef<ReadonlySet<string>>(new Set());

  const steps = useMemo<TourStep[]>(() => {
    const definitions = track === 'first-response'
      ? FIRST_RESPONSE_GUIDE_STEPS
      : track === 'channel'
        ? CHANNEL_GUIDE_STEPS
        : AGENT_GUIDE_STEPS;
    const intro = track === 'first-response'
      ? {
          title: t('businessGuide.welcomeTitle'),
          description: t('businessGuide.welcomeDescription'),
        }
      : {
          title: t(`businessGuide.extensions.${track}.title`),
          description: t(`businessGuide.extensions.${track}.description`),
        };
    const finish = track === 'first-response'
      ? {
          title: t('businessGuide.finishTitle'),
          description: t('businessGuide.tour.finished'),
        }
      : {
          title: t('businessGuide.extensionReadyTitle'),
          description: t(`businessGuide.extensions.${track}.ready`),
        };
    return [
      { kind: 'intro', id: `${track}-intro`, ...intro },
      ...definitions.map((definition) => operationStep(definition, t)),
      { kind: 'finish', id: `${track}-finish`, ...finish },
    ];
  }, [t, track]);
  const step = steps[index] ?? steps[0];
  const operation = step.kind === 'operation' ? step : null;

  const advance = useCallback(() => {
    setIndex((current) => Math.min(current + 1, steps.length - 1));
  }, [steps.length]);

  const beginTrack = useCallback((nextTrack: GuideTrack) => {
    setTrack(nextTrack);
    setIndex(0);
    setGuidedUserMessageId(null);
  }, []);

  useEffect(() => {
    if (!tourOpen) return;
    setTrack('first-response');
    setIndex(Math.min(tourStartIndex, FIRST_RESPONSE_GUIDE_STEPS.length + 1));
    setGuidedUserMessageId(null);
  }, [tourOpen, tourStartIndex]);

  useEffect(() => {
    if (!tourOpen || !operation?.route || location.pathname === operation.route) return;
    navigate(operation.route);
  }, [location.pathname, navigate, operation?.route, tourOpen]);

  useEffect(() => {
    if (!tourOpen || !operation?.selector) {
      setTargetElement(null);
      setTargetRect(null);
      setTargetMissing(false);
      return undefined;
    }
    setTargetElement(null);
    setTargetRect(null);
    setTargetMissing(false);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const element = document.querySelector<HTMLElement>(operation.selector);
      if (element) {
        window.clearInterval(timer);
        element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
        setTargetElement(element);
        setTargetRect(element.getBoundingClientRect());
        if (element.matches('button, input, textarea, select, [tabindex]')) {
          window.setTimeout(() => element.focus({ preventScroll: true }), 180);
        }
        return;
      }
      if (Date.now() - startedAt >= TARGET_WAIT_MS) {
        window.clearInterval(timer);
        setTargetMissing(true);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [location.pathname, operation?.selector, targetAttempt, tourOpen]);

  useEffect(() => {
    if (!targetElement) return undefined;
    const update = () => setTargetRect(targetElement.getBoundingClientRect());
    const observer = new ResizeObserver(update);
    observer.observe(targetElement);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [targetElement]);

  useEffect(() => {
    const update = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    const update = () => setPanelSize({ width: panel.offsetWidth, height: panel.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [index, track, tourOpen]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'target-click') return undefined;
    const handleClick = (event: MouseEvent) => {
      const clicked = event.target instanceof Element
        ? event.target.closest(operation.selector)
        : null;
      if (clicked) advance();
    };
    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [advance, operation, tourOpen]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'selector-appears') return undefined;
    const completionSelector = operation.completion.selector;
    const timer = window.setInterval(() => {
      if (document.querySelector(completionSelector)) {
        window.clearInterval(timer);
        advance();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [advance, operation, tourOpen]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'config-saved') return undefined;
    window.addEventListener('aegis:config-saved', advance);
    return () => window.removeEventListener('aegis:config-saved', advance);
  }, [advance, operation, tourOpen]);

  useEffect(() => {
    if (operation?.completion.kind === 'session-created') {
      sessionBaselineRef.current = activeSessionKey;
    }
    if (operation?.completion.kind === 'user-message') {
      messageBaselineRef.current = new Set(messages.map((message) => message.id));
      setGuidedUserMessageId(null);
    }
  }, [operation?.id]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'session-created') return;
    if (sessionBaselineRef.current && activeSessionKey !== sessionBaselineRef.current) advance();
  }, [activeSessionKey, advance, operation, tourOpen]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'user-message') return;
    const sent = findNewUserMessage(messages, messageBaselineRef.current);
    if (!sent) return;
    setGuidedUserMessageId(sent.id);
    advance();
  }, [advance, messages, operation, tourOpen]);

  useEffect(() => {
    if (!tourOpen || operation?.completion.kind !== 'assistant-response' || !guidedUserMessageId) return;
    if (hasAssistantResponseAfter(messages, guidedUserMessageId)) advance();
  }, [advance, guidedUserMessageId, messages, operation, tourOpen]);

  useEffect(() => {
    if (!tourOpen) return undefined;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTour();
      if ((step.kind === 'intro' || step.kind === 'finish') && event.key === 'ArrowRight') advance();
      if ((step.kind === 'intro' || step.kind === 'finish') && event.key === 'ArrowLeft') {
        setIndex((current) => Math.max(current - 1, 0));
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [advance, closeTour, step.kind, tourOpen]);

  useEffect(() => {
    if (!tourOpen || step.kind === 'operation') return;
    window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
  }, [step.kind, tourOpen]);

  if (!active) return null;

  const showOverview = location.pathname === '/' && !welcomeDismissed;
  const placement = getCoachmarkPlacement(targetRect, viewport, panelSize);
  const panelStyle: CSSProperties = { left: placement.left, top: placement.top };
  const progressCurrent = Math.min(index + 1, steps.length);
  const isWaiting = Boolean(operation?.stateLabel && !targetMissing);
  const canUseExistingConfig = operation?.id === 'configure-model-provider';
  const canGoBack = operation?.id === 'choose-model-provider' || operation?.id === 'save-model-provider';

  const goBack = () => {
    if (operation?.id === 'choose-model-provider') {
      document.querySelector<HTMLElement>('[data-tour="provider-modal-close"]')?.click();
    }
    if (operation?.id === 'save-model-provider') {
      document.querySelector<HTMLElement>('[data-tour="provider-config-back"]')?.click();
    }
    setIndex((current) => Math.max(current - 1, 0));
  };

  return (
    <>
      {showOverview && (
        <section className="mx-5 mt-5 flex flex-col gap-4 rounded-lg border border-aegis-border bg-aegis-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between" aria-label={t('businessGuide.title')}>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-wide text-aegis-primary">{t('businessGuide.firstSuccessLabel')}</p>
            <h2 className="mt-1 text-sm font-semibold text-aegis-text">{t('businessGuide.welcomeTitle')}</h2>
            <p className="mt-1 max-w-[64ch] text-xs leading-5 text-aegis-text-muted">{t('businessGuide.contextualDescription')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="plain" onClick={dismissWelcome}>{t('businessGuide.later')}</Button>
            <Button size="sm" variant="solid" tone="primary" trailingIcon={<ArrowRight size={14} />} onClick={() => { dismissWelcome(); openTour(); }}>
              {t('businessGuide.startGuide')}
            </Button>
          </div>
        </section>
      )}
      {tourOpen && (
        <div className="pointer-events-none fixed inset-0 z-[200]" role="dialog" aria-modal="false" aria-label={t('businessGuide.title')}>
          {targetRect ? (
            <>
              <div className="pointer-events-auto fixed left-0 top-0 bg-black/50" style={{ width: '100vw', height: Math.max(0, targetRect.top - TARGET_GUTTER) }} />
              <div className="pointer-events-auto fixed left-0 bg-black/50" style={{ top: Math.max(0, targetRect.top - TARGET_GUTTER), width: Math.max(0, targetRect.left - TARGET_GUTTER), height: targetRect.height + TARGET_GUTTER * 2 }} />
              <div className="pointer-events-auto fixed right-0 bg-black/50" style={{ top: Math.max(0, targetRect.top - TARGET_GUTTER), width: Math.max(0, viewport.width - targetRect.right - TARGET_GUTTER), height: targetRect.height + TARGET_GUTTER * 2 }} />
              <div className="pointer-events-auto fixed bottom-0 left-0 bg-black/50" style={{ width: '100vw', top: targetRect.bottom + TARGET_GUTTER }} />
              <div className="fixed rounded-md ring-2 ring-aegis-primary shadow-[0_0_0_4px_rgb(var(--aegis-primary)/0.16)] motion-reduce:transition-none" style={{ left: targetRect.left - TARGET_GUTTER, top: targetRect.top - TARGET_GUTTER, width: targetRect.width + TARGET_GUTTER * 2, height: targetRect.height + TARGET_GUTTER * 2 }} />
            </>
          ) : <div className="pointer-events-auto absolute inset-0 bg-black/50" />}
          <div
            ref={panelRef}
            className="pointer-events-auto fixed w-[min(380px,calc(100vw-24px))] overflow-visible rounded-lg border border-aegis-border bg-aegis-surface shadow-[0_18px_48px_rgb(var(--aegis-overlay)/0.28)] transition-[transform,opacity] duration-150 motion-reduce:transition-none"
            style={panelStyle}
            data-side={placement.side}
          >
            <span aria-hidden="true" className={`absolute border-aegis-primary/50 ${connectorClass(placement.side)}`} />
            <div className="flex items-center justify-between border-b border-aegis-border px-4 py-3">
              <p className="text-[11px] font-semibold tabular-nums text-aegis-primary">{t('businessGuide.step', { current: progressCurrent, total: steps.length })}</p>
              <Button iconOnly size="xs" variant="ghost" onClick={closeTour} aria-label={t('businessGuide.dismiss')}>
                <X size={15} />
              </Button>
            </div>
            <div className="px-5 pb-5 pt-4">
              <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold tracking-[-0.01em] text-aegis-text focus:outline-none">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-aegis-text-muted">{step.description}</p>
              {isWaiting && (
                <div className="mt-3 flex items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg px-3 py-2 text-xs text-aegis-text-secondary" role="status" aria-live="polite">
                  <LoaderCircle size={14} className="shrink-0 animate-spin motion-reduce:animate-none" />
                  <span>{operation?.stateLabel}</span>
                </div>
              )}
              {targetMissing && (
                <div className="mt-3 rounded-md border border-aegis-danger/35 bg-aegis-danger/10 px-3 py-2" role="alert">
                  <p className="text-xs leading-5 text-aegis-danger">{t('businessGuide.targetMissing')}</p>
                  <Button className="mt-2" size="xs" variant="outline" tone="danger" leadingIcon={<RotateCcw size={12} />} onClick={() => setTargetAttempt((current) => current + 1)}>
                    {t('businessGuide.retryTarget')}
                  </Button>
                </div>
              )}
              {step.kind === 'finish' && (
                <div className="mt-4 flex items-start gap-2 rounded-md border border-aegis-success/30 bg-aegis-success/10 px-3 py-2 text-xs leading-5 text-aegis-text-secondary">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-aegis-success" />
                  <span>{track === 'first-response' ? t('businessGuide.verifiedByResponse') : t('businessGuide.extensionHandoff')}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-aegis-border bg-aegis-bg px-4 py-3">
              <Button size="xs" variant="plain" onClick={closeTour}>{t('businessGuide.exitGuide')}</Button>
              <div className="flex flex-wrap justify-end gap-2">
                {canGoBack && <Button size="xs" variant="outline" onClick={goBack}>{t('common.back')}</Button>}
                {canUseExistingConfig && (
                  <Button size="xs" variant="outline" onClick={() => setIndex(FIRST_RESPONSE_GUIDE_STEPS.findIndex((candidate) => candidate.id === 'new-session') + 1)}>
                    {t('businessGuide.useExistingConfig')}
                  </Button>
                )}
                {step.kind === 'intro' && (
                  <Button size="xs" variant="solid" tone="primary" trailingIcon={<ArrowRight size={13} />} onClick={advance}>
                    {t('businessGuide.startAction')}
                  </Button>
                )}
                {step.kind === 'finish' && track === 'first-response' && (
                  <>
                    <Button size="xs" variant="outline" onClick={() => beginTrack('channel')}>{t('businessGuide.extensions.channel.action')}</Button>
                    <Button size="xs" variant="outline" onClick={() => beginTrack('agent')}>{t('businessGuide.extensions.agent.action')}</Button>
                    <Button size="xs" variant="solid" tone="primary" onClick={closeTour}>{t('businessGuide.finish')}</Button>
                  </>
                )}
                {step.kind === 'finish' && track !== 'first-response' && (
                  <Button size="xs" variant="solid" tone="primary" onClick={closeTour}>{t('businessGuide.finish')}</Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
