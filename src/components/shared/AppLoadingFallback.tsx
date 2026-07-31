import { LoadingIndicator } from './LoadingIndicator';
import { useTranslation } from 'react-i18next';

interface AppLoadingFallbackProps {
  label?: string;
}

/** Full-window fallback used while a top-level lazy application surface loads. */
export function AppLoadingFallback({ label }: AppLoadingFallbackProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('app.loadingWorkspace');

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-aegis-bg text-aegis-text-muted">
      <LoadingIndicator size={32} label={resolvedLabel} className="text-aegis-primary" />
      <span className="font-sans text-[13px] opacity-70">{resolvedLabel}</span>
    </div>
  );
}
