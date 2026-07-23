import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Copy, Loader2, QrCode, RefreshCw, X } from 'lucide-react';
import {
  ChannelEnrollmentSession,
  type ChannelEnrollmentCompletion,
  type ChannelEnrollmentState,
} from '@/services/channelEnrollment';

export function ChannelEnrollmentDialog({
  channel,
  domain,
  finalizing = false,
  onClose,
  onConnected,
}: {
  channel: 'feishu';
  domain: 'feishu' | 'lark';
  finalizing?: boolean;
  onClose: () => void;
  onConnected: (completion: ChannelEnrollmentCompletion) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const session = useMemo(() => new ChannelEnrollmentSession(channel, domain), [channel, domain]);
  const [state, setState] = useState<ChannelEnrollmentState>(() => session.snapshot());
  const [handoffStarted, setHandoffStarted] = useState(false);
  const connectedNotified = useRef(false);
  const busy = state.phase === 'preparing' || state.phase === 'waiting' || finalizing || handoffStarted;

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.start();
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session]);

  useEffect(() => {
    if (state.phase !== 'connected' || connectedNotified.current) return;
    const completion = session.takeCompletion();
    if (!completion) return;
    connectedNotified.current = true;
    setHandoffStarted(true);
    onConnected(completion);
  }, [onConnected, session, state.phase]);

  const handleClose = useCallback(async () => {
    if (finalizing || handoffStarted) return;
    await session.cancel();
    onClose();
  }, [finalizing, handoffStarted, onClose, session]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !finalizing && !handoffStarted) void handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [finalizing, handoffStarted, handleClose]);

  const statusText = (finalizing || handoffStarted)
    ? t('setup.wizard.channelEnrollment.finalizing', '正在将已验证的凭据交给 OpenClaw 官方向导…')
    : state.phase === 'connected'
      ? t('setup.wizard.channelEnrollment.connected', '已验证，正在继续 OpenClaw 配置。')
      : state.phase === 'denied'
        ? t('setup.wizard.channelEnrollment.denied', '手机端拒绝了此次授权。请重新生成二维码。')
        : state.phase === 'expired'
          ? t('setup.wizard.channelEnrollment.expired', '二维码已过期。请重新生成后扫码。')
          : state.error === 'network_failed'
            ? t('setup.wizard.channelEnrollment.networkFailed', '无法连接飞书服务。请检查网络后重试。')
            : state.error === 'rate_limited'
              ? t('setup.wizard.channelEnrollment.rateLimited', '飞书服务繁忙，请稍后重新生成二维码。')
          : state.error === 'provider_rejected'
                ? t('setup.wizard.channelEnrollment.providerRejected', '飞书拒绝了本次二维码注册请求。请稍后重试。')
              : state.error === 'unsupported_verification_host'
                ? t('setup.wizard.channelEnrollment.protocolChanged', '飞书扫码入口已更新，当前 JunQi 版本尚不支持。请升级 JunQi 后重试。')
          : state.error
            ? t('setup.wizard.channelEnrollment.error', '二维码服务暂时不可用。请重新生成后重试。')
            : t('setup.wizard.channelEnrollment.waiting', '请使用飞书或 Lark 手机端扫描二维码。');

  return (
    <div className="fixed inset-0 z-[2147482500] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-sm rounded-lg border border-aegis-border bg-aegis-card-solid shadow-2xl">
        <div className="flex items-center justify-between border-b border-aegis-border px-4 py-3">
          <div id={titleId} className="flex items-center gap-2 text-sm font-bold text-aegis-text"><QrCode size={16} />{t('setup.wizard.channelEnrollment.title', '扫描二维码连接飞书')}</div>
          <button type="button" onClick={() => void handleClose()} disabled={finalizing || handoffStarted} title={t('common.close', 'Close')} className="p-1.5 text-aegis-text-muted hover:text-aegis-text disabled:opacity-50"><X size={16} /></button>
        </div>
        <div className="flex min-h-[350px] flex-col items-center justify-center gap-4 p-5 text-center">
          {state.phase === 'connected' ? (
            (finalizing || handoffStarted) ? <Loader2 size={46} className="animate-spin text-aegis-primary" /> : <CheckCircle2 size={54} className="text-aegis-success" />
          ) : state.qrDataUrl ? (
            <div className="rounded-md bg-white p-3"><img src={state.qrDataUrl} alt={t('setup.wizard.channelEnrollment.title', '扫描二维码连接飞书')} className="h-64 w-64" /></div>
          ) : busy ? (
            <Loader2 size={36} className="animate-spin text-aegis-primary" />
          ) : (
            <QrCode size={48} className="text-aegis-text-muted" />
          )}
          <p className="text-xs leading-relaxed text-aegis-text-secondary">{statusText}</p>
          {state.qrContent && <button type="button" onClick={() => void navigator.clipboard.writeText(state.qrContent!).catch(() => undefined)} className="inline-flex items-center gap-1.5 text-xs font-semibold text-aegis-primary hover:underline"><Copy size={13} />{t('common.copy', 'Copy link')}</button>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-aegis-border px-4 py-3">
          <button type="button" onClick={() => void handleClose()} disabled={finalizing || handoffStarted} className="rounded-md border border-aegis-border px-3 py-2 text-xs font-semibold text-aegis-text-secondary disabled:opacity-50">{t('common.close', 'Close')}</button>
          {state.phase !== 'connected' && <button type="button" disabled={busy} onClick={() => void session.start()} className="inline-flex items-center gap-1.5 rounded-md bg-aegis-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><RefreshCw size={13} />{t('common.refresh', 'Refresh')}</button>}
        </div>
      </div>
    </div>
  );
}
