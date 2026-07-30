import { Crosshair, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { prepareFocusNavigation } from '@/focus/openFocus';
import { useFocusProjection } from '@/focus/useFocusProjection';
import { useFocusContextStore } from '@/stores/focusContextStore';

export function FocusControl() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const focus = useFocusProjection();
  const clearFocus = useFocusContextStore((state) => state.clearFocus);
  if (!focus) return null;
  const canNavigate = focus.state !== 'unavailable';
  return (
    <div className="ml-auto flex h-[26px] max-w-[min(32vw,340px)] items-center rounded-md border border-aegis-border/70 bg-aegis-elevated/75 text-[10.5px]">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-aegis-text-secondary hover:text-aegis-text"
        onClick={() => { const route = prepareFocusNavigation(focus); if (route) navigate(route); }}
        disabled={!canNavigate}
        title={focus.title}
      >
        <Crosshair size={12} className={clsx('shrink-0', focus.state === 'running' && 'text-aegis-primary', focus.state === 'attention' && 'text-aegis-warning', focus.state === 'error' && 'text-aegis-danger')} />
        <span className="truncate font-semibold">{focus.title}</span>
        <span className="shrink-0 text-aegis-text-dim">{t(`focus.states.${focus.state}`)}</span>
      </button>
      <button type="button" className="grid h-[24px] w-[24px] place-items-center text-aegis-text-dim hover:text-aegis-text" onClick={clearFocus} title={t('focus.clear')} aria-label={t('focus.clear')}><X size={11} /></button>
    </div>
  );
}

