import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { GatewayRescueChat } from './GatewayRescueChat';

interface GatewayAiDiagnosticDisclosureProps {
  error: string;
  logs?: string;
  className?: string;
}

export function GatewayAiDiagnosticDisclosure({
  error,
  logs,
  className,
}: GatewayAiDiagnosticDisclosureProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className={clsx('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={clsx(
          'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs font-bold transition-colors',
          open
            ? 'border-aegis-primary/35 bg-aegis-primary/10 text-aegis-primary'
            : 'border-aegis-border bg-aegis-bg-primary text-aegis-text-secondary hover:border-aegis-primary/35 hover:text-aegis-primary',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Bot size={14} className="shrink-0" />
          <span>{t('gatewaySelfRescue.aiRescue', 'AI 诊断')}</span>
        </span>
        <ChevronDown size={14} className={clsx('shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-3 max-h-[min(560px,70vh)] overflow-y-auto">
          <GatewayRescueChat error={error} logs={logs} />
        </div>
      )}
    </div>
  );
}
