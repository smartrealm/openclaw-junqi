import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, QrCode, RefreshCw, ScanLine } from 'lucide-react';
import {
  ChannelQrLoginSession,
  type ChannelQrState,
  type ChannelQrLoginGateway,
} from '@/services/channelQrLogin';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { QrCodeDisplay } from '@/components/shared/QrCodeDisplay';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ChannelQrLoginDialog({
  client,
  channelId,
  accountId,
  onClose,
  onConnected,
}: {
  client: ChannelQrLoginGateway;
  channelId: string;
  accountId?: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const session = useMemo(
    () => new ChannelQrLoginSession(client, channelId, accountId),
    [accountId, channelId, client],
  );
  const [state, setState] = useState<ChannelQrState>(() => session.snapshot());
  const connectedNotified = useRef(false);
  const preparing = state.phase === 'preparing';
  const waiting = state.phase === 'waiting';
  const operationInProgress = preparing || waiting;
  const canContinueWaiting = Boolean(state.qrDataUrl)
    && (state.phase === 'pending' || state.error === 'qr_wait_failed');

  useEffect(() => {
    connectedNotified.current = false;
    const unsubscribe = session.subscribe(setState);
    void session.start(false);
    return () => {
      unsubscribe();
      session.cancel();
    };
  }, [session]);

  useEffect(() => {
    if (state.phase === 'connected' && !connectedNotified.current) {
      connectedNotified.current = true;
      onConnected();
    }
  }, [onConnected, state.phase]);

  const statusText = state.error === 'qr_invalid_response'
    ? t('channelsCenter.qrInvalidResponse', 'OpenClaw returned an invalid QR login response. Check the channel plugin and Gateway logs.')
    : state.error === 'qr_start_failed'
      ? t('channelsCenter.qrRequestFailed', 'OpenClaw could not start QR login for this channel.')
      : state.error === 'qr_wait_failed'
        ? t('channelsCenter.qrWaitFailed', 'OpenClaw could not continue monitoring this QR code. Retry monitoring or generate a new code.')
        : state.phase === 'connected'
          ? state.message || t('channelsCenter.qrConnected', 'Channel connected.')
          : state.phase === 'pending'
            ? state.message || t('channelsCenter.qrMonitoringPaused', 'OpenClaw stopped waiting. Continue monitoring or generate a new QR code.')
            : state.message || t('channelsCenter.qrWaiting', 'Waiting for OpenClaw to prepare the QR code...');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[min(440px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-card-solid p-0 text-aegis-text shadow-float">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="flex items-center gap-2 text-[14px] font-semibold text-aegis-text">
            <QrCode size={16} />
            {t('channelsCenter.scanQr', 'Scan QR code')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
            {t('channelsCenter.scanQrHint', 'Scan the code in the channel app. OpenClaw owns the authorization result and account connection.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[330px] flex-col items-center justify-center gap-4 px-5 py-6 text-center">
          {state.phase === 'connected' ? (
            <div className="grid h-48 w-48 place-items-center rounded-lg border border-aegis-success/35 bg-aegis-success/5">
              <CheckCircle2 size={52} className="text-aegis-success" />
            </div>
          ) : state.qrDataUrl ? (
            <div className="relative">
              <QrCodeDisplay
                dataUrl={state.qrDataUrl}
                alt={t('channelsCenter.scanQr', 'Scan QR code')}
                className="h-64 w-64"
              />
              {waiting && (
                <span className="absolute -bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-aegis-border bg-aegis-card-solid px-2.5 py-1 text-[10px] text-aegis-text-secondary shadow-sm">
                  <LoadingIndicator size={11} />
                  {t('channelsCenter.qrMonitoring', 'Monitoring scan status')}
                </span>
              )}
            </div>
          ) : preparing ? (
            <LoadingIndicator size={36} className="text-aegis-primary" />
          ) : (
            <QrCode size={48} className="text-aegis-text-muted" />
          )}
          <p role={state.phase === 'error' ? 'alert' : 'status'} className="max-w-[340px] text-[11px] leading-5 text-aegis-text-secondary">
            {statusText}
          </p>
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 border-t border-aegis-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-aegis-border px-3 text-[10.5px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
          >
            {t('common.close', 'Close')}
          </button>
          {canContinueWaiting && (
            <button
              type="button"
              onClick={() => void session.continueWaiting()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[10.5px] font-semibold text-aegis-text hover:bg-aegis-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
            >
              <ScanLine size={13} />
              {t('channelsCenter.continueMonitoring', 'Continue monitoring')}
            </button>
          )}
          {state.phase !== 'connected' && (
            <button
              type="button"
              disabled={operationInProgress}
              onClick={() => void session.start(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[10.5px] font-semibold text-white hover:bg-aegis-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} className={operationInProgress ? 'animate-spin' : undefined} />
              {t('channelsCenter.regenerateQr', 'Generate new QR code')}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
