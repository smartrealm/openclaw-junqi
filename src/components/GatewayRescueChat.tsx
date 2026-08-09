import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, KeyRound, Send, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import {
  gatewayRescueTargetKey,
  loadGatewayRescueTargets,
  sendGatewayRescueMessage,
  type GatewayRescueMessage,
  type GatewayRescueTarget,
} from '@/runtime/gatewayRescue';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';

interface GatewayRescueChatProps {
  error: string;
  logs?: string;
}

export function GatewayRescueChat({ error, logs }: GatewayRescueChatProps) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<GatewayRescueTarget | null>(null);
  const [targets, setTargets] = useState<GatewayRescueTarget[]>([]);
  const [loadingTarget, setLoadingTarget] = useState(true);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [messages, setMessages] = useState<GatewayRescueMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const context = useMemo(() => ({ error, logs }), [error, logs]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingTarget(true);
      setTargetError(null);
      try {
        const resolvedTargets = await loadGatewayRescueTargets();
        if (cancelled) return;
        setTargets(resolvedTargets);
        setMessages([]);
        setTarget(resolvedTargets[0] ?? null);
        if (resolvedTargets.length === 0) {
          setTargetError(t(
            'gatewayRescue.noTarget',
            'OpenClaw 没有返回可用的已配置模型。请先完成模型和凭据配置，或检查当前运行方式是否可用。',
          ));
        }
      } catch (loadError) {
        if (cancelled) return;
        setTargets([]);
        setTarget(null);
        const detail = loadError instanceof Error ? loadError.message : String(loadError);
        setTargetError(t('gatewayRescue.configReadFailed', {
          error: detail,
          defaultValue: '无法通过 OpenClaw 读取诊断模型：{{error}}',
        }));
      } finally {
        if (!cancelled) setLoadingTarget(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [t]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !target || sending) return;
    const nextMessages: GatewayRescueMessage[] = [...messages, { role: 'user', content: text }];
    const requestId = ++requestIdRef.current;
    const isCurrentRequest = () => mountedRef.current && requestIdRef.current === requestId;
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setRequestError(null);
    try {
      const reply = await sendGatewayRescueMessage(target, nextMessages, context);
      if (!isCurrentRequest()) return;
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (sendError) {
      if (!isCurrentRequest()) return;
      const detail = sendError instanceof Error ? sendError.message : String(sendError);
      setRequestError(t('gatewayRescue.sendFailedForTarget', {
        model: target.modelRef,
        error: detail,
        defaultValue: '{{model}} 诊断失败：{{error}}',
      }));
    } finally {
      if (isCurrentRequest()) setSending(false);
    }
  }, [context, draft, messages, sending, t, target]);

  return (
    <section className="min-w-0">
      {loadingTarget ? (
        <div className="flex items-center gap-2 py-4 text-xs text-aegis-text-muted">
          <LoadingIndicator size={13} />
          {t('gatewayRescue.loadingConfig', '正在通过 OpenClaw 读取模型配置…')}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {targetError && (
              <div className="flex items-start gap-2 rounded-lg border border-aegis-warning/25 bg-aegis-warning/[0.07] px-3 py-2 text-[11px] leading-relaxed text-aegis-warning">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{targetError}</span>
              </div>
            )}

            {targets.length > 0 && (
              <>
                <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
                  <span className="text-[11px] font-medium text-aegis-text-muted">
                    {t('gatewayRescue.targetLabel', '诊断模型')}
                  </span>
                  <label className="block">
                    <span className="sr-only">{t('gatewayRescue.targetLabel', '诊断模型')}</span>
                    <span className="relative block">
                      <select
                        value={target ? gatewayRescueTargetKey(target) : ''}
                        onChange={(event) => {
                          requestIdRef.current += 1;
                          setSending(false);
                          setMessages([]);
                          setRequestError(null);
                          setTarget(targets.find((item) => gatewayRescueTargetKey(item) === event.target.value) ?? null);
                        }}
                        className="w-full appearance-none truncate rounded-lg border border-aegis-border bg-aegis-bg-primary py-2 pl-2.5 pr-9 text-xs text-aegis-text-primary focus:border-aegis-primary/50 focus:outline-none"
                      >
                        {targets.map((item) => (
                          <option key={gatewayRescueTargetKey(item)} value={gatewayRescueTargetKey(item)}>
                            {item.modelRef} · {item.source === 'primary'
                              ? t('gatewayRescue.sourcePrimary', '默认')
                              : t('gatewayRescue.sourceConfigured', '候选')}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-aegis-text-muted"
                      />
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-[11px]">
                  <span className="font-medium text-aegis-text-muted">
                    {t('gatewayRescue.credentialLabel', '凭据来源')}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-aegis-text-secondary">
                    <KeyRound size={12} className="shrink-0 text-aegis-primary" />
                    <span className="truncate">
                      {t('gatewayRescue.credentialOpenClaw', 'OpenClaw 认证解析')}
                    </span>
                  </span>
                </div>
              </>
            )}
          </div>

          {requestError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/[0.07] px-3 py-2 text-[11px] leading-relaxed text-aegis-danger"
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{requestError}</span>
            </div>
          )}

          {(messages.length > 0 || sending) && (
            <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto border-t border-aegis-border pt-3">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={clsx(
                    'rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap',
                    message.role === 'user'
                      ? 'ml-8 bg-aegis-primary/12 text-aegis-text-primary'
                      : 'mr-8 bg-aegis-hover/35 text-aegis-text-secondary',
                  )}
                >
                  {message.content}
                </div>
              ))}
              {sending && (
                <div className="mr-8 flex items-center gap-2 rounded-lg bg-aegis-hover/35 px-3 py-2 text-xs text-aegis-text-muted">
                  <LoadingIndicator size={13} />
                  {t('gatewayRescue.sending', '正在分析…')}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 border-t border-aegis-border pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-aegis-text-muted">
              <ShieldCheck size={12} className="text-aegis-success" />
              <span>
                {t('gatewayRescue.safetyHint', '凭据由 OpenClaw 在本地解析，不会进入 JunQi 前端状态、诊断正文或日志。')}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={2}
                placeholder={t('gatewayRescue.placeholder', '例如：帮我诊断 Gateway 为什么启动失败，并给出最稳妥的修复步骤。')}
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-aegis-border bg-aegis-bg-primary px-3 py-2 text-xs text-aegis-text-primary placeholder:text-aegis-text-muted focus:border-aegis-primary/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || sending || !target}
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-aegis-primary text-white transition-colors hover:bg-aegis-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                title={t('gatewayRescue.send', '发送')}
                aria-label={t('gatewayRescue.send', '发送')}
              >
                {sending ? <LoadingIndicator size={16} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
