import { LoadingIndicator } from './LoadingIndicator';
import { useTranslation } from 'react-i18next';

interface AppLoadingFallbackProps {
  label?: string;
  errorLabel?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

/** Full-window fallback used while a top-level lazy application surface loads. */
export function AppLoadingFallback({ label, errorLabel, retryLabel, onRetry }: AppLoadingFallbackProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t('app.loadingWorkspace');
  const showRetry = Boolean(errorLabel && retryLabel && onRetry);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-aegis-bg text-aegis-text-muted">
      {showRetry ? (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <span className="font-sans text-[13px] text-aegis-text-secondary">{errorLabel}</span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md border border-aegis-border px-3 py-1.5 text-[12px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
          >
            {retryLabel}
          </button>
        </div>
      ) : (
        <>
          <LoadingIndicator size={32} label={resolvedLabel} className="text-aegis-primary" />
          <span className="font-sans text-[13px] opacity-70">{resolvedLabel}</span>
        </>
      )}
    </div>
  );
}
