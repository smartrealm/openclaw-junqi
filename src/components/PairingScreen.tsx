import { useMemo, useState } from 'react';
import { Check, Copy, Key, Loader2, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayAuthorizationIssue } from '@/services/gateway/messageRouter';

interface PairingScreenProps {
  issue: GatewayAuthorizationIssue;
  onPaired: (token: string) => void;
  onCancel: () => void;
}

/**
 * OpenClaw creates the pending device request during the WebSocket handshake.
 * This surface only renders that official request and waits for the existing
 * connection retry loop; it never invents a second HTTP pairing protocol.
 */
export function PairingScreen({ issue, onPaired, onCancel }: PairingScreenProps) {
  const { t, i18n } = useTranslation();
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
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

  const connectWithManualToken = async () => {
    const token = manualToken.trim();
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      const result = await window.aegis?.pairing?.saveToken(token);
      if (result && !result.success) return;
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
      <section className="relative w-full max-w-md overflow-hidden rounded-lg border border-aegis-border bg-aegis-card-solid shadow-2xl">
        <button
          type="button"
          onClick={onCancel}
          className="absolute end-4 top-4 grid h-9 w-9 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-glass hover:text-aegis-text"
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
          <p className="mb-5 text-sm leading-6 text-aegis-text-muted">
            {t('pairing.needsApprovalDesc')}
          </p>

          {requestId && (
            <div className="mb-3 w-full text-start">
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
              title={copied ? t('pairing.copied', 'Copied') : t('pairing.copyCommand', 'Copy command')}
              aria-label={copied ? t('pairing.copied', 'Copied') : t('pairing.copyCommand', 'Copy command')}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-aegis-text-dim">
            <Loader2 size={13} className="animate-spin text-aegis-primary" />
            <span>{t('pairing.waitingApprovalRetry')}</span>
          </div>

          {issue.message && (
            <p className="mt-3 max-w-full break-words font-mono text-[10px] leading-4 text-aegis-text-dim">
              {issue.code}: {issue.message}
            </p>
          )}

          <div className="mt-6 flex w-full gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 rounded-md border border-aegis-border px-4 py-2.5 text-sm text-aegis-text-muted transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
            >
              {t('pairing.cancel')}
            </button>
            <button
              type="button"
              onClick={() => setShowManualToken((value) => !value)}
              className="flex flex-1 items-center justify-center gap-2 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-4 py-2.5 text-sm font-medium text-aegis-primary transition-colors hover:bg-aegis-primary/15"
            >
              <Key size={15} />
              {t('pairing.enterTokenManually')}
            </button>
          </div>

          {showManualToken && (
            <div className="mt-4 w-full border-t border-aegis-border pt-4">
              <label htmlFor="gateway-manual-token" className="mb-2 block text-start text-xs text-aegis-text-muted">
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
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => void connectWithManualToken()}
                  disabled={!manualToken.trim() || submitting}
                  className="rounded-md bg-aegis-primary px-4 py-2 text-sm font-semibold text-aegis-btn-primary-text transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? <Loader2 size={15} className="animate-spin" /> : t('pairing.connect')}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
