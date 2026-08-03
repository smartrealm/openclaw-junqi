import { useMemo, useState } from 'react';
import { Check, Copy, Key, ShieldCheck, Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayAuthorizationIssue } from '@/services/gateway/messageRouter';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

interface PairingScreenProps {
  issue: GatewayAuthorizationIssue;
  onApprove: (requestId: string) => Promise<void>;
  onPaired: (token: string) => void;
  onCancel: () => void;
}

/**
 * OpenClaw creates and owns the pending device request. JunQi can execute the
 * official approval command for the selected local runtime only after the user
 * confirms; manual CLI and token entry remain recovery paths.
 */
export function PairingScreen({ issue, onApprove, onPaired, onCancel }: PairingScreenProps) {
  const { t, i18n } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestId = issue.requestId?.trim() || '';
  const approvalCommand = useMemo(
    () => requestId
      ? `openclaw devices approve ${requestId}`
      : 'openclaw devices list',
    [requestId],
  );

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(approvalCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const approveAndContinue = async () => {
    if (!requestId || submitting) return;
    setSubmitting(true);
    setApprovalError(null);
    try {
      await onApprove(requestId);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  };

  const connectWithManualToken = async () => {
    const token = manualToken.trim();
    if (!token || submitting) return;
    setSubmitting(true);
    setApprovalError(null);
    try {
      onPaired(token);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-aegis-bg-solid p-4"
      dir={i18n.dir()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="gateway-pairing-title"
    >
      <section className="relative max-h-[calc(100vh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-aegis-border bg-aegis-card-solid shadow-2xl">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="absolute end-4 top-4 grid h-9 w-9 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-glass hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
          title={t('pairing.cancel')}
          aria-label={t('pairing.cancel')}
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center px-8 pb-7 pt-9 text-center">
          <div className="mb-5 grid h-14 w-14 place-items-center rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-400">
            <ShieldCheck size={28} />
          </div>
          <h2 id="gateway-pairing-title" className="mb-2 text-[18px] font-semibold text-aegis-text">
            {t('pairing.needsApproval')}
          </h2>
          <p className="mb-3 text-sm leading-6 text-aegis-text-muted">
            {t('pairing.confirmApprovalDesc')}
          </p>
          <p className="mb-5 text-xs leading-5 text-aegis-text-dim">
            {t('pairing.confirmApprovalScope')}
          </p>

          {approvalError && (
            <div role="alert" className="mb-4 w-full rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-start text-xs leading-5 text-red-300">
              <div className="font-medium">{t('pairing.approvalFailed')}</div>
              <div className="mt-1 break-words font-mono text-[10px]">{approvalError}</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => void approveAndContinue()}
            disabled={!requestId || submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-aegis-primary px-4 py-2.5 text-sm font-semibold text-aegis-btn-primary-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <LoadingIndicator size={15} /> : <ShieldCheck size={16} />}
            {submitting ? t('pairing.approving') : t('pairing.confirmAndContinue')}
          </button>

          <div className="mt-4 flex items-center gap-2 text-xs text-aegis-text-dim">
            <LoadingIndicator size={13} className="text-aegis-primary" />
            <span>{t('pairing.waitingApprovalRetry')}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            disabled={submitting}
            className="mt-5 flex items-center gap-2 rounded-md px-3 py-2 text-xs text-aegis-text-muted transition-colors hover:bg-aegis-glass hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
            aria-expanded={showAdvanced}
          >
            <Terminal size={14} />
            {showAdvanced ? t('pairing.hideAdvanced') : t('pairing.showAdvanced')}
          </button>

          {showAdvanced && (
            <div className="mt-2 w-full border-t border-aegis-border pt-4 text-start">
              <p className="mb-3 text-xs leading-5 text-aegis-text-muted">
                {t('pairing.advancedDesc')}
              </p>
              {requestId && (
                <div className="mb-3">
                  <span className="text-[11px] font-medium uppercase text-aegis-text-dim">Request ID</span>
                  <div className="mt-1 break-all font-mono text-xs text-aegis-text-muted">{requestId}</div>
                </div>
              )}
              <div className="flex w-full items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg-solid p-2 ps-3" dir="ltr">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-start text-xs text-aegis-primary">
                  {approvalCommand}
                </code>
                <button
                  type="button"
                  onClick={() => void copyCommand()}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-glass hover:text-aegis-text"
                  title={copied ? t('pairing.copied') : t('pairing.copyCommand')}
                  aria-label={copied ? t('pairing.copied') : t('pairing.copyCommand')}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>

              {issue.message && (
                <p className="mt-3 max-w-full break-words font-mono text-[10px] leading-4 text-aegis-text-dim">
                  {issue.code}: {issue.message}
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowManualToken((value) => !value)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-aegis-border px-4 py-2.5 text-sm text-aegis-text-muted transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
              >
                <Key size={15} />
                {t('pairing.enterTokenManually')}
              </button>

              {showManualToken && (
                <div className="mt-4 w-full">
                  <label htmlFor="gateway-manual-token" className="mb-2 block text-xs text-aegis-text-muted">
                    {t('pairing.enterTokenDesc')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="gateway-manual-token"
                      type="password"
                      value={manualToken}
                      onChange={(event) => setManualToken(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void connectWithManualToken();
                      }}
                      placeholder={t('pairing.pasteToken')}
                      className="min-w-0 flex-1 rounded-md border border-aegis-border bg-aegis-bg-solid px-3 py-2 text-sm text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary"
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={() => void connectWithManualToken()}
                      disabled={!manualToken.trim() || submitting}
                      className="rounded-md bg-aegis-primary px-4 py-2 text-sm font-semibold text-aegis-btn-primary-text transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {submitting ? <LoadingIndicator size={15} /> : t('pairing.connect')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="mt-4 rounded-md px-4 py-2 text-xs text-aegis-text-dim transition-colors hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('pairing.cancel')}
          </button>
        </div>
      </section>
    </div>
  );
}
