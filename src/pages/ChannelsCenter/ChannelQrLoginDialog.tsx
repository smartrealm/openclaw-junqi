import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, Loader2, QrCode, RefreshCw, X } from 'lucide-react';
import { gateway } from '@/services/gateway';
import {
  ChannelQrLoginSession,
  createOfficialChannelConnectedVerifier,
  type ChannelQrState,
} from '@/services/channelQrLogin';
import { renderLocalQrDataUrl } from '@/services/qrPresentation';

export function ChannelQrLoginDialog({
  channelId,
  accountId,
  onClose,
  onConnected,
}: {
  channelId: string;
  accountId?: string;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const verifyConnected = useMemo(
    () => createOfficialChannelConnectedVerifier(gateway, channelId, accountId),
    [accountId, channelId],
  );
  const session = useMemo(
    () => new ChannelQrLoginSession(gateway, channelId, accountId, verifyConnected),
    [accountId, channelId, verifyConnected],
  );
  const [state, setState] = useState<ChannelQrState>(() => session.snapshot());
  const [renderedQrDataUrl, setRenderedQrDataUrl] = useState<string | null>(null);
  const [qrRenderFailed, setQrRenderFailed] = useState(false);
  const connectedNotified = useRef(false);
  const busy = state.phase === 'preparing' || state.phase === 'waiting' || state.phase === 'verifying';

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.start(false);
    return () => {
      unsubscribe();
      session.cancel();
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    if (!state.qrContent) {
      setRenderedQrDataUrl(null);
      setQrRenderFailed(false);
      return () => { cancelled = true; };
    }
    setQrRenderFailed(false);
    void renderLocalQrDataUrl(state.qrContent).then((dataUrl) => {
      if (!cancelled) {
        setRenderedQrDataUrl(dataUrl);
        setQrRenderFailed(!dataUrl);
      }
    });
    return () => { cancelled = true; };
  }, [state.qrContent]);

  useEffect(() => {
    if (state.phase === 'connected' && !connectedNotified.current) {
      connectedNotified.current = true;
      onConnected();
    }
  }, [onConnected, state.phase]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const statusText = state.error === 'qr_unavailable'
    ? t('channelsCenter.qrUnavailable', 'OpenClaw did not return a QR code. Check the Gateway and channel logs.')
    : state.error === 'qr_denied'
      ? t('channelsCenter.qrDenied', 'The QR sign-in was declined. Generate a new QR code and try again.')
    : state.error === 'qr_expired'
      ? t('channelsCenter.qrTimedOut', 'The QR code expired. Refresh it and try again.')
      : qrRenderFailed
        ? t('channelsCenter.qrRenderFailed', 'The QR code could not be displayed. Refresh it and try again.')
      : state.error === 'qr_not_ready'
        ? t('channelsCenter.qrNotReady', 'The scan completed, but OpenClaw could not confirm that the channel account is running. Check channel status and try again.')
      : state.error === 'qr_status_failed'
        ? t('channelsCenter.qrStatusFailed', 'The scan completed, but channel status could not be verified. Check the Gateway connection and refresh.')
      : state.error === 'qr_login_failed'
        ? t('channelsCenter.qrLoginFailed', 'OpenClaw ended the QR login without connecting this channel. Generate a new QR code and try again.')
      : state.error === 'qr_request_failed'
        ? t('channelsCenter.qrRequestFailed', 'OpenClaw could not start QR login. Check that this OpenClaw version supports QR login for the selected channel.')
        : state.phase === 'verifying'
          ? t('channelsCenter.qrVerifying', 'QR sign-in succeeded. Verifying the channel account with OpenClaw...')
          : state.message || t('channelsCenter.qrWaiting', 'Waiting for OpenClaw to prepare the QR code...');

  return (
    <div className="fixed inset-0 z-[2147482500] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm rounded-lg border border-aegis-border bg-aegis-card-solid shadow-2xl">
        <div className="flex items-center justify-between border-b border-aegis-border px-4 py-3">
          <div id={titleId} className="flex items-center gap-2 text-sm font-bold text-aegis-text"><QrCode size={16} />{t('channelsCenter.scanQr', 'Scan QR code')}</div>
          <button type="button" onClick={onClose} title={t('common.close', 'Close')} className="p-1.5 text-aegis-text-muted hover:text-aegis-text"><X size={16} /></button>
        </div>
        <div className="flex min-h-[350px] flex-col items-center justify-center gap-4 p-5 text-center">
          {state.phase === 'connected' ? (
            <CheckCircle2 size={54} className="text-aegis-success" />
          ) : state.qrDataUrl || renderedQrDataUrl ? (
            <div className="rounded-md bg-white p-3"><img src={state.qrDataUrl ?? renderedQrDataUrl ?? ''} alt={t('channelsCenter.scanQr', 'Scan QR code')} className="h-64 w-64" /></div>
          ) : busy && !qrRenderFailed ? (
            <Loader2 size={36} className="animate-spin text-aegis-primary" />
          ) : (
            <QrCode size={48} className="text-aegis-text-muted" />
          )}
          <p className="text-xs leading-relaxed text-aegis-text-secondary">{statusText}</p>
          {state.qrContent && <button type="button" onClick={() => void navigator.clipboard.writeText(state.qrContent!).catch(() => undefined)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"><Copy size={13} />{t('common.copy', 'Copy link')}</button>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-aegis-border px-4 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-aegis-border px-3 py-2 text-xs font-semibold text-aegis-text-secondary">{t('common.close', 'Close')}</button>
          {state.phase !== 'connected' && <button type="button" disabled={busy} onClick={() => void session.start(true)} className="inline-flex items-center gap-1.5 rounded-md bg-aegis-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={13} />{t('common.refresh', 'Refresh')}</button>}
        </div>
      </div>
    </div>
  );
}
