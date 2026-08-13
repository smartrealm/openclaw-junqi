import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ExternalLink, LoaderCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { detectGatewayConfig } from '@/api/tauri-commands';
import { gateway } from '@/services/gateway';
import { GatewayRpcError } from '@/services/gateway/Connection';
import {
  createScopedOpenClawWizardSessionStore,
  isOpenClawWizardTerminalResult,
  OPENCLAW_WIZARD_SESSION_STORAGE_KEYS,
  OpenClawWizardClient,
  type OpenClawWizardConfiguredAccount,
  type OpenClawWizardResult,
  type OpenClawWizardSessionScope,
  type OpenClawWizardStep,
} from '@/services/openclawWizard';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { WizardStepRenderer } from '@/pages/SetupPage/wizard/WizardStepRenderer';
import { WizardAuthorizationHint } from '@/pages/SetupPage/wizard/WizardAuthorizationHint';
import { wizardInitialValue } from '@/pages/SetupPage/wizard/WizardStepValue';

function isUnsupportedChannelsWizard(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && error.code === 'INVALID_REQUEST'
    && /(wizard\.start|flow|channel|unknown\s+(field|key)|unrecognized|invalid\s+params)/i.test(error.message);
}

function terminalResultError(result: OpenClawWizardResult, fallback: string): string | null {
  if (result.error || (isOpenClawWizardTerminalResult(result) && result.status === 'error')) {
    return result.error?.trim() || fallback;
  }
  return null;
}

export function ChannelSetupWizardDialog({
  channelId,
  channelLabel,
  onClose,
  onComplete,
  onTerminalFallback,
}: {
  channelId: string;
  channelLabel: string;
  onClose: () => void;
  onComplete: (accounts: OpenClawWizardConfiguredAccount[]) => void;
  onTerminalFallback: () => void;
}) {
  const { t } = useTranslation();
  const scopeRef = useRef<OpenClawWizardSessionScope | null>(null);
  const mountedRef = useRef(true);
  const clientRef = useRef<OpenClawWizardClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new OpenClawWizardClient(
      (method, params, options) => gateway.callPrivileged(method, params, options),
      createScopedOpenClawWizardSessionStore(
        () => scopeRef.current,
        `${OPENCLAW_WIZARD_SESSION_STORAGE_KEYS.channels}:${encodeURIComponent(channelId)}`,
      ),
    );
  }
  const client = clientRef.current;
  const [step, setStep] = useState<OpenClawWizardStep | null>(null);
  const [value, setValue] = useState<unknown>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);

  const applyResult = (result: OpenClawWizardResult) => {
    const resultError = terminalResultError(result, t(
      'channelsCenter.wizardFailed',
      'OpenClaw 渠道配置向导执行失败。',
    ));
    if (resultError) {
      setError(resultError);
      setStep(result.step ?? null);
      return;
    }
    if (isOpenClawWizardTerminalResult(result) && result.status === 'done') {
      onComplete(result.accounts ?? []);
      return;
    }
    if (!result.step) {
      setError(t('channelsCenter.wizardMissingStep', 'OpenClaw did not return the next channel setup step.'));
      return;
    }
    setStep(result.step);
    setValue(wizardInitialValue(result.step));
  };

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    const start = async () => {
      setBusy(true);
      setError('');
      setUnsupported(false);
      try {
        const target = await detectGatewayConfig();
        if (!target.ws_url) throw new Error('The selected OpenClaw Runtime did not report a Gateway URL.');
        scopeRef.current = { runtimeMode: target.runtime_mode, gatewayWsUrl: target.ws_url };
        const result = client.hasActiveSession
          ? await client.resume()
          : await client.start({ flow: 'channels', channel: channelId });
        if (active) applyResult(result);
      } catch (reason: unknown) {
        if (!active) return;
        if (isUnsupportedChannelsWizard(reason)) {
          client.forgetSession();
          setUnsupported(true);
        } else {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        if (active) setBusy(false);
      }
    };
    void start();
    return () => {
      active = false;
      mountedRef.current = false;
      client.invalidatePendingOperations();
    };
  }, [channelId, client]);

  const submit = async () => {
    if (!step || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.next(step.id, value);
      if (mountedRef.current) applyResult(result);
    } catch (reason: unknown) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const close = () => {
    client.invalidatePendingOperations();
    onClose();
  };

  const blocked = Boolean(
    step
    && (step.type === 'select' || step.type === 'multiselect')
    && (step.options?.length ?? 0) === 0,
  );

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-h-[min(760px,94dvh)] w-[min(760px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text shadow-float sm:rounded-lg">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="text-[15px] font-semibold text-aegis-text">
            {step?.title || t('channelsCenter.configureChannel', 'Configure channel')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
            {channelLabel} · {channelId}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(94dvh-132px)] overflow-y-auto px-5 py-5">
          {unsupported ? (
            <div className="rounded-lg border border-aegis-warning/25 bg-aegis-warning/5 p-4">
              <div className="flex items-start gap-2 text-aegis-warning">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{t('channelsCenter.channelsWizardUnsupported', 'This OpenClaw Runtime does not support the desktop channel wizard.')}</p>
                  <p className="mt-1 text-xs leading-5 text-aegis-text-secondary">{t('channelsCenter.channelsWizardUnsupportedHint', 'Continue with the official terminal channel setup, or update the selected OpenClaw Runtime.')}</p>
                </div>
              </div>
            </div>
          ) : busy && !step ? (
            <div className="flex min-h-52 items-center justify-center gap-2 text-xs text-aegis-text-muted">
              <LoadingIndicator size={18} />
              {t('channelsCenter.startingChannelWizard', 'Starting the official OpenClaw channel wizard...')}
            </div>
          ) : (
            <div className="space-y-4">
              {error && <div role="alert" className="rounded-lg border border-aegis-danger/25 bg-aegis-danger/5 p-3 text-xs leading-5 text-aegis-danger">{error}</div>}
              {busy && step ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 text-center">
                  <LoaderCircle size={24} className="animate-spin text-aegis-primary" />
                  <p className="text-xs text-aegis-text-secondary">{t('setup.wizard.authorizationPollingHint', 'OpenClaw is waiting for the official plugin to return the result.')}</p>
                </div>
              ) : step ? (
                <>
                  <WizardStepRenderer step={step} value={value} setValue={setValue} t={t} />
                  <WizardAuthorizationHint step={step} />
                </>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-aegis-border bg-aegis-surface px-5 py-3">
          <button type="button" onClick={close} className="h-8 rounded-md border border-aegis-border px-3 text-[10.5px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35">
            {t('common.close', 'Close')}
          </button>
          {unsupported ? (
            <button type="button" onClick={onTerminalFallback} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[10.5px] font-semibold text-[rgb(var(--aegis-btn-primary-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35">
              <ExternalLink size={13} />
              {t('channelsCenter.continueInTerminal', 'Continue in terminal')}
            </button>
          ) : step ? (
            <button type="button" onClick={() => void submit()} disabled={busy || blocked} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[10.5px] font-semibold text-[rgb(var(--aegis-btn-primary-text))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:opacity-50">
              {busy && <LoadingIndicator size={12} />}
              {t('setup.nextStep', 'Next')}
            </button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
