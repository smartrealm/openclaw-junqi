import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, ChevronRight, KeyRound, Loader2, Send, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import {
  buildManualGatewayRescueTarget,
  classifyGatewayRescueFailure,
  gatewayRescueTargetKey,
  resolveGatewayRescueTargets,
  sendGatewayRescueMessage,
  type GatewayRescueMessage,
  type GatewayRescueTarget,
  type RescueProviderApi,
} from '@/services/gatewayRescue';

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
  const [manualOpen, setManualOpen] = useState(false);
  const [manualApi, setManualApi] = useState<RescueProviderApi>('openai-compatible');
  const [manualBaseUrl, setManualBaseUrl] = useState('');
  const [manualModelId, setManualModelId] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const context = useMemo(() => ({ error, logs }), [error, logs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadingTarget(true);
      setTargetError(null);
      try {
        const { data } = await window.aegis.config.read('');
        const resolvedTargets = resolveGatewayRescueTargets(data as GatewayRuntimeConfig);
        if (cancelled) return;
        setTargets(resolvedTargets);
        setMessages([]);
        if (resolvedTargets.length === 0) {
          setTarget(null);
          setManualOpen(true);
          setTargetError(t('gatewayRescue.noTarget', '没有找到可直连的大模型配置。你可以临时填写一个模型用于本次自救，不会写入 openclaw.json。'));
          return;
        }
        setTarget(resolvedTargets[0]);
      } catch (err: any) {
        if (cancelled) return;
        setTargets([]);
        setTarget(null);
        setManualOpen(true);
        setTargetError(err?.message || t('gatewayRescue.configReadFailed', '读取 OpenClaw 配置失败。你仍可临时填写一个模型用于本次自救。'));
      } finally {
        if (!cancelled) setLoadingTarget(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [t]);

  const applyManualTarget = useCallback(() => {
    const manual = buildManualGatewayRescueTarget({
      api: manualApi,
      baseUrl: manualBaseUrl,
      apiKey: manualApiKey,
      modelId: manualModelId,
    });
    if (!manual) {
      setTargetError(t('gatewayRescue.manualIncomplete', '请完整填写 Base URL、API Key 和模型 ID。'));
      return;
    }
    setTarget(manual);
    setTargetError(null);
    setRequestError(null);
    setManualOpen(false);
  }, [manualApi, manualApiKey, manualBaseUrl, manualModelId, t]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !target || sending) return;
    const nextMessages: GatewayRescueMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    setRequestError(null);
    try {
      const reply = await sendGatewayRescueMessage(target, nextMessages, context);
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      const kind = classifyGatewayRescueFailure(err);
      const rawError = err?.message || String(err);
      setRequestError(kind === 'authentication'
        ? t('gatewayRescue.authFailed', { provider: target.providerId, defaultValue: '{{provider}} 拒绝了当前凭据（401）。请更新该供应商的 API Key，或切换其他诊断模型。' })
        : kind === 'permission'
          ? t('gatewayRescue.permissionFailed', { provider: target.providerId, defaultValue: '{{provider}} 拒绝了当前凭据的访问权限（403）。请检查模型权限或切换其他诊断模型。' })
          : t('gatewayRescue.sendFailedForTarget', { model: target.modelRef, error: rawError, defaultValue: '{{model}} 直连失败：{{error}}' }));
    } finally {
      setSending(false);
    }
  }, [context, draft, messages, sending, t, target]);

  const targetKey = target ? gatewayRescueTargetKey(target) : '';
  const credentialLabel = target?.credentialSource === 'manual'
    ? t('gatewayRescue.credentialManual', '临时凭据')
    : target?.credentialSource.includes('env') || target?.credentialSource.startsWith('template-')
      ? t('gatewayRescue.credentialEnvironment', '环境变量')
      : target?.credentialSource.startsWith('profile-')
        ? t('gatewayRescue.credentialProfile', '认证配置')
        : t('gatewayRescue.credentialProvider', '供应商配置');

  return (
    <section className="min-w-0">
      {loadingTarget ? (
        <div className="flex items-center gap-2 py-4 text-xs text-aegis-text-muted">
          <Loader2 size={13} className="animate-spin" />
          {t('gatewayRescue.loadingConfig', '正在读取模型配置…')}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {targetError && (
              <div className="flex items-start gap-2 rounded-lg border border-orange-400/20 bg-orange-400/[0.06] px-3 py-2 text-[11px] leading-relaxed text-orange-300">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{targetError}</span>
              </div>
            )}

            {targets.length > 1 ? (
              <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2">
                <span className="text-[11px] font-medium text-aegis-text-muted">
                  {t('gatewayRescue.targetLabel', '诊断模型')}
                </span>
                <label className="block">
                  <span className="sr-only">{t('gatewayRescue.targetLabel', '诊断模型')}</span>
                  <span className="relative block">
                    <select
                      value={targetKey}
                      onChange={(event) => {
                        const next = targets.find((item) => gatewayRescueTargetKey(item) === event.target.value);
                        if (!next) return;
                        setTarget(next);
                        setTargetError(null);
                        setRequestError(null);
                      }}
                      className="w-full appearance-none truncate rounded-lg border border-aegis-border bg-black/20 py-2 pl-2.5 pr-9 text-xs text-aegis-text-primary focus:border-aegis-primary/50 focus:outline-none"
                    >
                      {target?.source === 'manual' && (
                        <option value={targetKey}>
                          {t('gatewayRescue.manualTarget', '临时模型')} · {target.modelRef}
                        </option>
                      )}
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
            ) : target ? (
              <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-[11px]">
                <span className="font-medium text-aegis-text-muted">
                  {t('gatewayRescue.targetLabel', '诊断模型')}
                </span>
                <span className="truncate font-medium text-aegis-text-primary" title={target.modelRef}>
                  {target.modelRef}
                </span>
              </div>
            ) : null}

            {target && (
              <div className="grid grid-cols-[76px_minmax(0,1fr)] items-center gap-2 text-[11px]">
                <span className="font-medium text-aegis-text-muted">
                  {t('gatewayRescue.credentialLabel', '凭据来源')}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 text-aegis-text-secondary">
                  <KeyRound size={12} className="shrink-0 text-aegis-primary" />
                  <span className="truncate">{credentialLabel}</span>
                </span>
              </div>
            )}

            <button
              type="button"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((value) => !value)}
              className="flex items-center gap-1 text-[11px] font-medium text-aegis-primary hover:text-aegis-primary-hover"
            >
              {manualOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {manualOpen
                ? t('gatewayRescue.hideManual', '收起临时模型配置')
                : t('gatewayRescue.showManual', '使用临时模型配置')}
            </button>

            {manualOpen && (
              <div className="grid gap-2 border-l-2 border-aegis-primary/25 pl-3">
                <select
                  value={manualApi}
                  onChange={(event) => setManualApi(event.target.value as RescueProviderApi)}
                  className="rounded-lg border border-aegis-border bg-black/20 px-2.5 py-2 text-xs text-aegis-text-primary focus:border-aegis-primary/50 focus:outline-none"
                >
                  <option value="openai-compatible">{t('gatewayRescue.apiOpenAi', 'OpenAI 兼容')}</option>
                  <option value="anthropic-messages">{t('gatewayRescue.apiAnthropic', 'Anthropic Messages')}</option>
                </select>
                <input
                  value={manualBaseUrl}
                  onChange={(event) => setManualBaseUrl(event.target.value)}
                  placeholder={t('gatewayRescue.baseUrlPlaceholder', 'Base URL，例如 https://api.openai.com/v1')}
                  className="rounded-lg border border-aegis-border bg-black/20 px-2.5 py-2 text-xs text-aegis-text-primary placeholder:text-aegis-text-muted focus:border-aegis-primary/50 focus:outline-none"
                />
                <input
                  value={manualModelId}
                  onChange={(event) => setManualModelId(event.target.value)}
                  placeholder={t('gatewayRescue.modelPlaceholder', '模型 ID，例如 gpt-4o-mini')}
                  className="rounded-lg border border-aegis-border bg-black/20 px-2.5 py-2 text-xs text-aegis-text-primary placeholder:text-aegis-text-muted focus:border-aegis-primary/50 focus:outline-none"
                />
                <input
                  value={manualApiKey}
                  onChange={(event) => setManualApiKey(event.target.value)}
                  type="password"
                  placeholder={t('gatewayRescue.apiKeyPlaceholder', '临时 API Key，不会写入配置文件')}
                  className="rounded-lg border border-aegis-border bg-black/20 px-2.5 py-2 text-xs text-aegis-text-primary placeholder:text-aegis-text-muted focus:border-aegis-primary/50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={applyManualTarget}
                  className="rounded-lg border border-aegis-primary/35 bg-aegis-primary/10 px-3 py-2 text-xs font-bold text-aegis-primary hover:bg-aegis-primary/16"
                >
                  {t('gatewayRescue.useManual', '使用临时模型')}
                </button>
              </div>
            )}
          </div>

          {requestError && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/[0.07] px-3 py-2 text-[11px] leading-relaxed text-red-300"
            >
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{requestError}</span>
            </div>
          )}

          {(messages.length > 0 || sending) && (
            <div className="mt-3 max-h-[220px] space-y-2 overflow-y-auto border-t border-aegis-border pt-3">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={clsx(
                    'rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap',
                    message.role === 'user'
                      ? 'ml-8 bg-aegis-primary/12 text-aegis-text-primary'
                      : 'mr-8 bg-white/[0.04] text-aegis-text-secondary',
                  )}
                >
                  {message.content}
                </div>
              ))}
              {sending && (
                <div className="mr-8 flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-aegis-text-muted">
                  <Loader2 size={13} className="animate-spin" />
                  {t('gatewayRescue.sending', '正在分析…')}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 border-t border-aegis-border pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-aegis-text-muted">
              <ShieldCheck size={12} className="text-aegis-success" />
              <span>
                {t('gatewayRescue.safetyHint', 'API Key 仅用于向所选模型服务鉴权，不会写入诊断正文或日志。')}
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
                className="min-h-[44px] flex-1 resize-none rounded-lg border border-aegis-border bg-black/20 px-3 py-2 text-xs text-aegis-text-primary placeholder:text-aegis-text-muted focus:border-aegis-primary/50 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={!draft.trim() || sending || !target}
                className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg bg-aegis-primary text-white transition-colors hover:bg-aegis-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                title={t('gatewayRescue.send', '发送')}
                aria-label={t('gatewayRescue.send', '发送')}
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
