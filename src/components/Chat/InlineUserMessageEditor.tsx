import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function InlineUserMessageEditor({
  initialValue,
  onCancel,
  onSave,
}: {
  initialValue: string;
  onCancel: () => void;
  onSave: (content: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const content = draft.trim();
    if (!content || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(content);
    } catch {
      setError(t('chat.sendFailed', 'Send failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-[min(520px,70vw)] min-w-0 max-w-full">
      <textarea
        autoFocus
        value={draft}
        disabled={saving}
        rows={Math.min(Math.max(draft.split('\n').length + 1, 3), 10)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
        className="block min-h-[76px] w-full resize-y rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.04)] p-2.5 text-[14px] leading-relaxed text-aegis-text outline-none transition-colors focus:border-aegis-primary/45 disabled:cursor-wait disabled:opacity-70"
        aria-label={t('chat.editMessage', 'Edit message')}
      />
      <div className="mt-2 flex items-center justify-end gap-1.5">
        {error && <span className="me-auto text-[10px] text-aegis-danger">{error}</span>}
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-45"
          title={t('chat.cancel', 'Cancel')}
          aria-label={t('chat.cancel', 'Cancel')}
        >
          <X size={15} />
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || !draft.trim()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-aegis-primary text-white transition-colors hover:bg-aegis-primary/85 disabled:cursor-not-allowed disabled:opacity-45"
          title={t('chat.saveAndRetry', 'Save and retry')}
          aria-label={t('chat.saveAndRetry', 'Save and retry')}
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
        </button>
      </div>
    </div>
  );
}
