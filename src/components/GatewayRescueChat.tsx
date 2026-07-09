import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, AlertCircle, Loader2, Send, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import type { GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import {
  buildManualGatewayRescueTarget,
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
        if (resolvedTargets.length === 0) {
          setTarget(null);
          setManualOpen(true);
          setTargetError(t('gatewayRescue.noTarget', '没有找到可直连的大模型配置。你可以临时填写一个模型用于本次自救，不会写入 openclaw.json。'));
          return;
        }
        setTarget(resolvedTargets[0]);
        setMessages([{
          role: 'assistant',
          content: t('gatewayRescue.readyMessage', '我可以不经过 Gateway，直接使用当前配置的大模型帮你分析启动失败原因。你可以直接发送“帮我诊断并给出修复步骤”。'),
        }]);
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
    setMessages((prev) => prev.length > 0 ? prev : [{
      role: 'assistant',
      content: t('gatewayRescue.readyMessage', '我可以不经过 Gateway，直接使用当前配置的大模型帮你分析启动失败原因。你可以直接发送“帮我诊断并给出修复步骤”。'),
    }]);
  }, [manualApi, manualApiKey, manualBaseUrl, manualModelId, t]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !target || sending) return;
    const nextMessages: GatewayRescueMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setDraft('');
    setSending(true);
    try {
      const reply = await sendGatewayRescueMessage(target, nextMessages, context);
      setMessages([...nextMessages, { role: 'assistant', content: reply }]);
    } catch (err: any) {
      setMessages([...nextMessages, {
        role: 'assistant',
        content: t('gatewayRescue.sendFailed', { error: err?.message || String(err) }),
      }]);
      setManualOpen(true);
    } finally {
      setSending(false);
    }
  }, [context, draft, messages, sending, t, target]);

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-aegis-border bg-aegis-bg-primary/80">
      <div className="flex items-start justify-between gap-3 border-b border-aegis-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-aegis-text-primary">
            <Bot size={15} className="text-aegis-primary" />
            <span>{t('gatewayRescue.title', 'AI 救援')}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-aegis-text-muted">
            {t('gatewayRescue.subtitle', 'Gateway 无法启动时，直接调用配置里的大模型分析日志和修复路径。')}
          </p>
        </div>
        {target && (
          <div className="max-w-[220px] shrink-0 truncate rounded-md border border-aegis-primary/25 bg-aegis-primary/10 px-2 py-1 text-[10px] font-medium text-aegis-primary" title={target.modelRef}>
            {target.source === 'manual' ? t('gatewayRescue.manualTarget', '临时模型') : target.modelRef}
          </div>
        )}
      </div>

      {loadingTarget ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-aegis-text-muted">
          <Loader2 size={13} className="animate-spin" />
          {t('gatewayRescue.loadingConfig', '正在读取模型配置…')}
        </div>
      ) : (
        <>
          {targetError && (
            <div className="flex items-start gap-2 px-4 py-3 text-xs leading-relaxed text-orange-300">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{targetError}</span>
            </div>
          )}

          {(targets.length > 0 || manualOpen) && (
            <div className="space-y-2 border-b border-aegis-border px-4 py-3">
              {targets.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-[10.5px] font-medium text-aegis-text-muted">
                    {t('gatewayRescue.targetLabel', '诊断模型')}
                  </span>
                  <select
                    value={target?.source === 'manual' ? '__manual__' : target?.modelRef ?? ''}
                    onChange={(event) => {
                      if (event.target.value === '__manual__') return;
                      const next = targets.find((item) => item.modelRef === event.target.value) ?? null;
                      setTarget(next);
                      setTargetError(null);
                    }}
                    className="w-full rounded-lg border border-aegis-border bg-black/20 px-2.5 py-2 text-xs text-aegis-text-primary focus:border-aegis-primary/50 focus:outline-none"
                  >
                    {targets.map((item) => (
                      <option key={`${item.baseUrl}:${item.modelRef}`} value={item.modelRef}>
                        {item.modelRef} · {item.source === 'primary' ? t('gatewayRescue.sourcePrimary', '默认') : t('gatewayRescue.sourceConfigured', '候选')}
                      </option>
                    ))}
                    {target?.source === 'manual' && <option value="__manual__">{t('gatewayRescue.manualTarget', '临时模型')}</option>}
                  </select>
                </label>
              )}

              <button
                onClick={() => setManualOpen((value) => !value)}
                className="text-[11px] font-medium text-aegis-primary hover:text-aegis-primary-hover"
              >
                {manualOpen ? t('gatewayRescue.hideManual', '收起临时模型配置') : t('gatewayRescue.showManual', '使用临时模型配置')}
              </button>

              {manualOpen && (
                <div className="grid gap-2 rounded-lg border border-aegis-border/60 bg-white/[0.02] p-3">
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
                    onClick={applyManualTarget}
                    className="rounded-lg border border-aegis-primary/35 bg-aegis-primary/10 px-3 py-2 text-xs font-bold text-aegis-primary hover:bg-aegis-primary/16"
                  >
                    {t('gatewayRescue.useManual', '使用临时模型')}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="max-h-[220px] space-y-2 overflow-y-auto px-4 py-3">
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

          <div className="border-t border-aegis-border px-3 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-aegis-text-muted">
              <ShieldCheck size={12} className="text-aegis-success" />
              <span>{t('gatewayRescue.safetyHint', '只发送错误文本和日志摘要，不会发送 API Key。')}</span>
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
    </div>
  );
}
