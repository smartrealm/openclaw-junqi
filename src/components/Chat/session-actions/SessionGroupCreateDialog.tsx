import { useEffect, useRef, useState, type FormEvent } from 'react';
import { FolderPlus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

export interface SessionGroupCreateDialogProps {
  readonly onDismiss: () => void;
  readonly onCreate: (name: string) => Promise<void>;
  readonly onCreated: () => void;
}

/** Desktop dialog for the native menu's "New group" action. */
export function SessionGroupCreateDialog({ onDismiss, onCreate, onCreated }: SessionGroupCreateDialogProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate(normalized);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-aegis-scrim p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onDismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !submitting) {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-group-create-title"
        onSubmit={(event) => void submit(event)}
        className="w-[min(360px,calc(100vw-32px))] rounded-lg border border-aegis-menu-border bg-aegis-menu-bg p-4 shadow-[var(--aegis-menu-shadow)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <FolderPlus size={16} className="shrink-0 text-aegis-primary" aria-hidden="true" />
            <div className="min-w-0">
              <h2 id="session-group-create-title" className="text-[13px] font-semibold text-aegis-text">
                {t('chat.newSessionGroup')}
              </h2>
              <p className="mt-1 text-[11px] leading-4 text-aegis-text-muted">
                {t('chat.newSessionGroupDescription')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={submitting}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-40"
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        <label className="mt-4 block text-[11px] font-medium text-aegis-text-secondary" htmlFor="session-group-name">
          {t('chat.sessionGroupName')}
        </label>
        <input
          ref={inputRef}
          id="session-group-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={submitting}
          placeholder={t('chat.newSessionCategoryPlaceholder')}
          className="mt-1.5 h-9 w-full rounded-md border border-aegis-border bg-aegis-bg px-2.5 text-[12px] text-aegis-text outline-none transition-colors placeholder:text-aegis-text-dim focus:border-aegis-primary disabled:opacity-60"
        />
        {error && <p className="mt-2 text-[10.5px] leading-4 text-aegis-danger" role="alert">{error}</p>}
        <footer className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            disabled={submitting}
            className="h-8 rounded-md px-3 text-[11px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!name.trim() || submitting}
            className="inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-3 text-[11px] font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/16 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting && <LoadingIndicator size={12} />}
            {t('common.create')}
          </button>
        </footer>
      </form>
    </div>
  );
}
