import { LoadingIndicator } from './LoadingIndicator';

interface AppLoadingFallbackProps {
  label?: string;
}

/** Full-window fallback used while a top-level lazy application surface loads. */
export function AppLoadingFallback({ label = 'Loading workspace...' }: AppLoadingFallbackProps) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 bg-aegis-bg text-aegis-text-muted">
      <LoadingIndicator size={32} label={label} className="text-aegis-primary" />
      <span className="font-sans text-[13px] opacity-70">{label}</span>
    </div>
  );
}
