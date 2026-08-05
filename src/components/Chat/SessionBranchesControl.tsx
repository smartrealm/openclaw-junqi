import { CheckCircle2, GitBranch, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionTranscriptBranch } from '@/services/gateway/SessionTranscriptHistoryClient';
import { useSessionTranscriptBranches } from '@/hooks/useSessionTranscriptBranches';
import { showConfirm } from '@/components/shared/AlertDialog';

interface SessionBranchesControlProps {
  readonly sessionKey: string;
  readonly agentId: string;
  readonly enabled: boolean;
}

export function SessionBranchesControl({ sessionKey, agentId, enabled }: SessionBranchesControlProps) {
  const { t } = useTranslation();
  const { capabilities, branches, loading, error, refresh, switchBranch } = useSessionTranscriptBranches(
    sessionKey,
    agentId,
    enabled,
  );
  const [switching, setSwitching] = useState<string | null>(null);

  if (!capabilities.branches) return null;

  const switchTo = (branch: SessionTranscriptBranch) => {
    if (!capabilities.branchSwitch || branch.active) return;
    showConfirm(
      t('chat.sessionTranscript.switchConfirmTitle'),
      t('chat.sessionTranscript.switchConfirmMessage'),
      async () => {
        setSwitching(branch.leafEntryId);
        try {
          await switchBranch(branch.leafEntryId);
          window.dispatchEvent(new CustomEvent('aegis:session-reset', { detail: { sessionKey } }));
          await refresh();
        } finally {
          setSwitching(null);
        }
      },
    );
  };

  return (
    <section className="border-b border-aegis-border py-3">
      <div className="mb-2 flex items-center gap-2">
        <GitBranch size={13} className="text-aegis-text-muted" />
        <h3 className="text-[11px] font-semibold text-aegis-text">{t('chat.sessionTranscript.branches')}</h3>
        <span className="ms-auto font-mono text-[10px] text-aegis-text-dim">{branches.length}</span>
      </div>
      {loading && <div className="flex items-center gap-2 py-2 text-[10.5px] text-aegis-text-dim"><LoaderCircle size={12} className="animate-spin" />{t('chat.sessionTranscript.loadingBranches')}</div>}
      {!loading && error && <div className="text-[10.5px] text-aegis-danger">{t('chat.sessionTranscript.branchesFailed')}</div>}
      {!loading && !error && branches.length === 0 && <div className="text-[10.5px] text-aegis-text-dim">{t('chat.sessionTranscript.noBranches')}</div>}
      {!loading && !error && branches.length > 0 && (
        <div className="space-y-1.5">
          {branches.map((branch) => (
            <div key={branch.leafEntryId} className="rounded-md border border-aegis-border px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 break-words text-[10.5px] text-aegis-text">{branch.headline || t('chat.sessionTranscript.untitledBranch')}</span>
                {branch.active && <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-aegis-success" aria-label={t('chat.sessionTranscript.activeBranch')} />}
              </div>
              <div className="mt-1 text-[9.5px] text-aegis-text-dim">{t('chat.sessionTranscript.branchMessageCount', { count: branch.messageCount })}</div>
              {!branch.active && capabilities.branchSwitch && (
                <button
                  type="button"
                  disabled={switching !== null}
                  onClick={() => switchTo(branch)}
                  className="mt-2 rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
                >
                  {switching === branch.leafEntryId ? t('chat.sessionTranscript.switchingBranch') : t('chat.sessionTranscript.switchBranch')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
