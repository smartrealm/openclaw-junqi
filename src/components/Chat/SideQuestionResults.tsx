import { MessageCircleQuestion, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { OpenClawBtwSideResult } from '@/services/gateway/openClawBtw';

export function SideQuestionResults({
  results,
  onDismiss,
}: {
  results: readonly OpenClawBtwSideResult[];
  onDismiss: (sessionKey: string, runId: string) => void;
}) {
  const { t } = useTranslation();
  if (results.length === 0) return null;
  return (
    <div className="space-y-2 px-5 py-2">
      {results.map((result) => (
        <section
          key={result.runId}
          className="border border-sky-400/20 bg-sky-400/[0.04] px-3 py-2.5"
          aria-label={t('chat.sideQuestion.title')}
        >
          <div className="flex items-start gap-2">
            <MessageCircleQuestion size={15} className="mt-0.5 shrink-0 text-sky-300/80" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-aegis-text">{t('chat.sideQuestion.title')}</span>
                {result.isError && (
                  <span className="text-[10px] text-aegis-danger">{t('chat.sideQuestion.error')}</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-aegis-text-dim">{result.question}</div>
              <div className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-aegis-text">
                {result.text}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDismiss(result.sessionKey, result.runId)}
              className="grid size-7 shrink-0 place-items-center text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-aegis-primary"
              aria-label={t('chat.sideQuestion.dismiss')}
              title={t('chat.sideQuestion.dismiss')}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
