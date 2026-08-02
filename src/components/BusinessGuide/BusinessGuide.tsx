import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Check, Circle, Play, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { projectBusinessGuide } from '@/business-guide/domain';
import { useBusinessGuideActivation } from '@/hooks/useBusinessGuideActivation';
import { useBusinessGuideChannelFact } from '@/hooks/useBusinessGuideChannelFact';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useBusinessGuideStore } from '@/stores/businessGuideStore';

interface TourStep {
  id: string;
  route?: string;
  selector?: string;
  title: string;
  description: string;
}

function getTourPanelStyle(target: DOMRect | null): CSSProperties {
  if (!target) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  const panelHeight = 272;
  const panelWidth = 420;
  const below = target.bottom + 18;
  const top = below + panelHeight <= window.innerHeight
    ? below
    : Math.max(16, target.top - panelHeight - 18);
  return {
    left: Math.max(16, Math.min(window.innerWidth - panelWidth - 16, target.left)),
    top,
  };
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
  const connected = useChatStore((state) => state.connected);
  const hasModels = useChatStore((state) => state.availableModels.length > 0);
  const hasSession = useChatStore((state) => state.sessions.some((session) => (
    session.key !== 'agent:main:main'
  )));
  const hasAgent = useGatewayDataStore((state) => state.agents.length > 0);
  const active = useBusinessGuideActivation();
  const hasReadyChannel = useBusinessGuideChannelFact(active && connected);
  const tasks = useMemo(
    () => projectBusinessGuide({ connected, hasModels, hasSession, hasAgent, hasReadyChannel }),
    [connected, hasModels, hasSession, hasAgent, hasReadyChannel],
  );
  const steps = useMemo<TourStep[]>(() => [
    { id: 'welcome', title: t('businessGuide.welcomeTitle'), description: t('businessGuide.welcomeDescription') },
    { id: 'start-chat', route: '/chat', selector: '[data-tour="chat-new-session"]', title: t('businessGuide.tasks.startChat.title'), description: t('businessGuide.tour.newSession') },
    { id: 'choose-model', route: '/config', selector: '[data-tour="providers-add"]', title: t('businessGuide.tasks.chooseModel.title'), description: t('businessGuide.tour.addProvider') },
    { id: 'review-agents', route: '/agents', selector: '[data-tour="agents-add"]', title: t('businessGuide.tasks.reviewAgents.title'), description: t('businessGuide.tour.addAgent') },
    { id: 'connect-channel', route: '/channels', selector: '[data-tour="channels-add"]', title: t('businessGuide.tasks.connectChannel.title'), description: t('businessGuide.tour.addChannel') },
    { id: 'open-workspace', route: '/welcome', selector: '[data-tour="workspace-open-project"]', title: t('businessGuide.tasks.openWorkspace.title'), description: t('businessGuide.tour.openWorkspace') },
    { id: 'finish', title: t('businessGuide.finish'), description: t('businessGuide.tour.finished') },
  ], [t]);
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<DOMRect | null>(null);
  const step = steps[index];

  useEffect(() => {
    if (tourOpen) setIndex(Math.min(tourStartIndex, steps.length - 1));
  }, [steps.length, tourOpen, tourStartIndex]);
  useEffect(() => {
    if (!tourOpen || !step.route || location.pathname === step.route) return;
    navigate(step.route);
  }, [location.pathname, navigate, step.route, tourOpen]);
  useEffect(() => {
    if (!tourOpen || !step.selector) {
      setTarget(null);
      return undefined;
    }
    setTarget(null);
    let mounted = true;
    let frame = 0;
    let timer: number | undefined;
    const findTarget = () => {
      const element = document.querySelector<HTMLElement>(step.selector!);
      if (!mounted || !element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
      setTarget(element.getBoundingClientRect());
      return true;
    };
    const observe = () => {
      if (findTarget()) return;
      timer = window.setTimeout(observe, 100);
    };
    observe();
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const element = document.querySelector<HTMLElement>(step.selector!);
        if (element) setTarget(element.getBoundingClientRect());
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      mounted = false;
      if (timer) window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [location.pathname, step.selector, tourOpen]);
  useEffect(() => {
    if (!tourOpen || !step.selector) return undefined;
    const advanceAfterTargetAction = (event: MouseEvent) => {
      const clicked = event.target instanceof Element
        ? event.target.closest(step.selector!)
        : null;
      if (!clicked) return;
      window.setTimeout(() => setIndex((current) => Math.min(current + 1, steps.length - 1)), 120);
    };
    document.addEventListener('click', advanceAfterTargetAction, true);
    return () => document.removeEventListener('click', advanceAfterTargetAction, true);
  }, [step.selector, steps.length, tourOpen]);
  useEffect(() => {
    if (!tourOpen) return undefined;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTour();
      if (!step.selector && event.key === 'ArrowRight') setIndex((current) => Math.min(current + 1, steps.length - 1));
      if (!step.selector && event.key === 'ArrowLeft') setIndex((current) => Math.max(current - 1, 0));
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [closeTour, step.selector, steps.length, tourOpen]);

  if (!active) return null;

  const completed = tasks.filter((task) => task.state === 'completed').length;
  const showOverview = location.pathname === '/' && !welcomeDismissed;
  return (
    <>
      {showOverview && (
        <section className="mx-5 mt-5 border border-aegis-border bg-aegis-surface shadow-sm" aria-label={t('businessGuide.title')}>
          <div className="flex items-start justify-between gap-4 border-b border-aegis-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-aegis-text">{t('businessGuide.title')}</h2>
              <p className="mt-1 text-xs text-aegis-text-muted">{t('businessGuide.progress', { completed, total: tasks.length })}</p>
            </div>
            <button type="button" title={t('businessGuide.dismiss')} aria-label={t('businessGuide.dismiss')} onClick={dismissWelcome} className="p-1 text-aegis-text-muted hover:text-aegis-text"><X size={16} /></button>
          </div>
          <ul className="grid divide-y divide-aegis-border md:grid-cols-2 md:divide-x md:divide-y-0">
            {tasks.map((task) => (
              <li key={task.id} className="flex items-center gap-3 px-5 py-3">
                {task.state === 'completed' ? <Check size={16} className="text-emerald-500" /> : task.state === 'blocked' ? <Circle size={16} className="text-aegis-text-muted" /> : <Play size={16} className="text-aegis-primary" />}
                <button type="button" onClick={() => openTour(tasks.findIndex((item) => item.id === task.id) + 1)} className="min-w-0 text-left">
                  <span className="block text-xs font-semibold text-aegis-text">{t(task.titleKey)}</span>
                  <span className="block text-[11px] text-aegis-text-muted">{task.state === 'blocked' ? t('businessGuide.blocked') : t(task.descriptionKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {tourOpen && (
        <div className="pointer-events-none fixed inset-0 z-[2147481000]" role="dialog" aria-modal="true" aria-label={t('businessGuide.title')}>
          {target ? (
            <>
              <div className="pointer-events-auto fixed left-0 top-0 bg-black/55" style={{ width: '100vw', height: Math.max(0, target.top - 4) }} />
              <div className="pointer-events-auto fixed left-0 bg-black/55" style={{ top: Math.max(0, target.top - 4), width: Math.max(0, target.left - 4), height: target.height + 8 }} />
              <div className="pointer-events-auto fixed right-0 bg-black/55" style={{ top: Math.max(0, target.top - 4), width: Math.max(0, window.innerWidth - target.right - 4), height: target.height + 8 }} />
              <div className="pointer-events-auto fixed bottom-0 left-0 bg-black/55" style={{ width: '100vw', top: target.bottom + 4 }} />
              <div className="fixed rounded-md ring-4 ring-aegis-primary/70" style={{ left: target.left - 4, top: target.top - 4, width: target.width + 8, height: target.height + 8 }} />
            </>
          ) : <div className="pointer-events-auto absolute inset-0 bg-black/55" />}
          <div className="pointer-events-auto fixed w-[min(420px,calc(100vw-32px))] border border-aegis-border bg-aegis-surface shadow-2xl" style={getTourPanelStyle(target)}>
            <div className="flex justify-end px-4 pt-3"><button type="button" onClick={closeTour} aria-label={t('businessGuide.dismiss')} className="text-aegis-text-muted hover:text-aegis-text"><X size={18} /></button></div>
            <div className="px-6 pb-6"><p className="text-xs font-semibold text-aegis-primary">{t('businessGuide.step', { current: index + 1, total: steps.length })}</p><h2 className="mt-2 text-lg font-semibold text-aegis-text">{step.title}</h2><p className="mt-3 text-sm leading-6 text-aegis-text-muted">{step.description}</p></div>
            <div className="flex items-center justify-between border-t border-aegis-border bg-aegis-bg px-4 py-3">
              <button type="button" onClick={closeTour} className="text-xs text-aegis-text-muted">{t('businessGuide.skip')}</button>
              <div className="flex gap-2">
                <button type="button" disabled={index === 0} onClick={() => setIndex((current) => Math.max(current - 1, 0))} className="border border-aegis-border px-3 py-2 text-xs disabled:opacity-40">{t('common.back')}</button>
                {step.selector ? <button type="button" onClick={() => setIndex((current) => Math.min(current + 1, steps.length - 1))} className="border border-aegis-border px-3 py-2 text-xs text-aegis-text-muted">{t('businessGuide.skipStep')}</button> : <button type="button" onClick={() => index === steps.length - 1 ? closeTour() : setIndex((current) => current + 1)} className="bg-aegis-primary px-3 py-2 text-xs font-semibold text-white">{index === steps.length - 1 ? t('businessGuide.finish') : t('common.next')}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
