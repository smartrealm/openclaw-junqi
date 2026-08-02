import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, Play, X, Compass } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { projectBusinessGuide } from '@/business-guide/domain';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import { useBusinessGuideStore } from '@/stores/businessGuideStore';
import { useBusinessGuideChannelFact } from '@/hooks/useBusinessGuideChannelFact';

export function BusinessGuide() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dismissed = useBusinessGuideStore((s) => s.dismissed);
  const dismiss = useBusinessGuideStore((s) => s.dismiss);
  const tourOpen = useBusinessGuideStore((s) => s.tourOpen);
  const closeTour = useBusinessGuideStore((s) => s.closeTour);
  const [step, setStep] = useState(0);
  const connected = useChatStore((s) => s.connected);
  const hasModels = useChatStore((s) => s.availableModels.length > 0);
  const hasSession = useChatStore((s) => s.sessions.some((session) => !session.localOnly));
  const hasAgent = useGatewayDataStore((s) => s.agents.length > 0);
  const hasReadyChannel = useBusinessGuideChannelFact(connected);
  const tasks = useMemo(() => projectBusinessGuide({ connected, hasModels, hasSession, hasAgent, hasReadyChannel }), [connected, hasModels, hasSession, hasAgent, hasReadyChannel]);
  useEffect(() => { if (!tourOpen) return; const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTour(); if (event.key === 'ArrowRight') setStep((value) => Math.min(value + 1, 5)); if (event.key === 'ArrowLeft') setStep((value) => Math.max(value - 1, 0)); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [closeTour, tourOpen]);
  if (dismissed) return <button type="button" title={t('businessGuide.reopen')} aria-label={t('businessGuide.reopen')} onClick={() => useBusinessGuideStore.getState().reopen()} className="absolute right-5 top-5 z-10 flex h-8 w-8 items-center justify-center border border-aegis-border bg-aegis-surface text-aegis-text-muted shadow-sm hover:text-aegis-text"><Compass size={16} /></button>;
  const completed = tasks.filter((task) => task.state === 'completed').length;
  const tourTask = step === 0 ? null : tasks[step - 1];
  const showOverview = location.pathname === '/';
  return <>{showOverview && <section className="mx-5 mt-5 border border-aegis-border bg-aegis-surface shadow-sm" aria-label={t('businessGuide.title')}>
    <div className="flex items-start justify-between gap-4 border-b border-aegis-border px-5 py-4">
      <div><h2 className="text-sm font-semibold text-aegis-text">{t('businessGuide.title')}</h2><p className="mt-1 text-xs text-aegis-text-muted">{t('businessGuide.progress', { completed, total: tasks.length })}</p></div>
      <button type="button" title={t('businessGuide.dismiss')} aria-label={t('businessGuide.dismiss')} onClick={dismiss} className="p-1 text-aegis-text-muted hover:text-aegis-text"><X size={16} /></button>
    </div>
    <ul className="grid divide-y divide-aegis-border md:grid-cols-2 md:divide-x md:divide-y-0">
      {tasks.map((task) => <li key={task.id} className="flex items-center gap-3 px-5 py-3">
        {task.state === 'completed' ? <Check size={16} className="text-emerald-500" /> : task.state === 'blocked' ? <Circle size={16} className="text-aegis-text-muted" /> : <Play size={16} className="text-aegis-primary" />}
        <button type="button" onClick={() => navigate(task.route)} className="min-w-0 text-left"><span className="block text-xs font-semibold text-aegis-text">{t(task.titleKey)}</span><span className="block text-[11px] text-aegis-text-muted">{task.state === 'blocked' ? t('businessGuide.blocked') : t(task.descriptionKey)}</span></button>
      </li>)}
    </ul>
  </section>}{tourOpen && <div className="fixed inset-0 z-[2147481000] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={t('businessGuide.title')}><div className="w-full max-w-2xl overflow-hidden border border-aegis-border bg-aegis-surface shadow-2xl"><div className="flex justify-end px-5 pt-4"><button type="button" onClick={closeTour} aria-label={t('businessGuide.dismiss')} className="text-aegis-text-muted hover:text-aegis-text"><X size={18}/></button></div><div className="px-8 pb-8"><p className="text-xs font-semibold text-aegis-primary">{t('businessGuide.step', { current: step + 1, total: 6 })}</p><h2 className="mt-3 text-2xl font-semibold text-aegis-text">{step === 0 ? t('businessGuide.welcomeTitle') : t(tourTask!.titleKey)}</h2><p className="mt-4 text-sm leading-7 text-aegis-text-muted">{step === 0 ? t('businessGuide.welcomeDescription') : t(tourTask!.descriptionKey)}</p></div><div className="flex items-center justify-between border-t border-aegis-border bg-aegis-bg px-5 py-4"><button type="button" onClick={closeTour} className="text-xs text-aegis-text-muted hover:text-aegis-text">{t('businessGuide.skip')}</button><div className="flex gap-2"><button type="button" onClick={() => setStep((value) => Math.max(value - 1, 0))} disabled={step === 0} className="border border-aegis-border px-3 py-2 text-xs disabled:opacity-40">{t('common.back')}</button><button type="button" onClick={() => step === 5 ? closeTour() : setStep((value) => value + 1)} className="bg-aegis-primary px-3 py-2 text-xs font-semibold text-white">{step === 5 ? t('businessGuide.finish') : t('common.next')}</button></div></div></div></div>}</>;
}
