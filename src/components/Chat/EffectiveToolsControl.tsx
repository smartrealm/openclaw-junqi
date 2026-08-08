import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, Play, RefreshCw, Settings2, Wrench, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { gateway } from '@/services/gateway';
import { useEffectiveTools } from '@/hooks/useEffectiveTools';
import type { EffectiveToolEntry, EffectiveToolGroup, EffectiveToolRisk, EffectiveToolSource } from '@/services/gateway/toolsEffective';
import type { ToolsInvokeResult } from '@/services/gateway/toolsInvoke';
import { ChatIconButton } from './ChatIconButton';

interface EffectiveToolsControlProps {
  sessionKey: string;
  agentId: string;
  onOpenConfiguration: () => void;
}

const SOURCE_KEYS: Record<EffectiveToolSource, string> = {
  core: 'core',
  plugin: 'plugin',
  channel: 'channel',
  mcp: 'mcp',
};

const RISK_KEYS: Record<EffectiveToolRisk, string> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};

function toolCount(groups: EffectiveToolGroup[]): number {
  return groups.reduce((total, group) => total + group.tools.length, 0);
}

// tools.effective remains the server-side allow-list; the invoke panel never invents tool names.
function formatToolOutput(value: unknown): string {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

export function EffectiveToolsControl({ sessionKey, agentId, onOpenConfiguration }: EffectiveToolsControlProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<EffectiveToolEntry | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [invoking, setInvoking] = useState(false);
  const [invocation, setInvocation] = useState<ToolsInvokeResult | null>(null);
  const [invocationError, setInvocationError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { result, loading, error, refresh } = useEffectiveTools(sessionKey, agentId, open);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const total = result ? toolCount(result.groups) : 0;
  const selectTool = (tool: EffectiveToolEntry) => {
    setSelectedTool(tool);
    setArgsText('{}');
    setInvocation(null);
    setInvocationError(null);
  };
  const requestInvoke = () => {
    if (!selectedTool || invoking) return;
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('chat.effectiveTools.invokeArgsInvalid'));
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      setInvocationError(error instanceof Error ? error.message : t('chat.effectiveTools.invokeArgsInvalid'));
      return;
    }
    setInvocationError(null);
    showConfirm(
      t('chat.effectiveTools.invokeConfirmTitle'),
      t('chat.effectiveTools.invokeConfirmMessage', { toolName: selectedTool.id }),
      async () => {
        setInvoking(true);
        setInvocation(null);
        try {
          const response = await gateway.invokeTool({
            name: selectedTool.id,
            args,
            sessionKey: sessionKey.trim(),
            agentId: agentId.trim(),
            confirm: true,
            idempotencyKey: `junqi-tool-${crypto.randomUUID()}`,
          });
          setInvocation(response);
          if (!response.ok) {
            setInvocationError(response.error?.message || t('chat.effectiveTools.invokeFailed'));
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setInvocationError(message);
          showAlert(t('chat.effectiveTools.invokeError'), message, 'error');
        } finally {
          setInvoking(false);
        }
      },
    );
  };
  return (
    <div ref={rootRef} className="relative no-drag">
      <ChatIconButton
        type="button"
        label={t('chat.effectiveTools.open')}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-aegis-text-dim transition-colors',
          'hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary',
          open && 'bg-[rgb(var(--aegis-overlay)/0.07)] text-aegis-text',
        )}
      >
        <Wrench size={11} aria-hidden="true" />
        {total > 0 && <span className="text-[9px] font-mono">{total}</span>}
      </ChatIconButton>

      {open && (
        <div
          role="dialog"
          aria-label={t('chat.effectiveTools.title')}
          className="absolute top-full end-0 z-50 mt-2 flex w-[min(420px,calc(100vw-24px))] max-h-[min(560px,calc(100vh-88px))] flex-col overflow-hidden rounded-lg border border-aegis-menu-border bg-aegis-menu-bg"
          style={{ boxShadow: 'var(--aegis-menu-shadow)' }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-aegis-menu-border px-3 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-aegis-text">{t('chat.effectiveTools.title')}</div>
              <div className="mt-0.5 truncate text-[10px] text-aegis-text-dim">{sessionKey}</div>
            </div>
            <button
              type="button"
              onClick={() => { void refresh(); }}
              disabled={loading}
              className="grid size-7 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text disabled:cursor-wait disabled:opacity-50"
              title={t('chat.effectiveTools.refresh')}
              aria-label={t('chat.effectiveTools.refresh')}
            >
              <RefreshCw size={12} className={clsx(loading && 'animate-spin')} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && (
              <div className="flex items-center gap-2 py-5 text-[11px] text-aegis-text-muted">
                <LoaderCircle size={14} className="animate-spin" />
                <span>{t('chat.effectiveTools.loading')}</span>
              </div>
            )}

            {!loading && error && (
              <div className="space-y-2 rounded-md border border-aegis-danger/25 bg-aegis-danger/5 px-3 py-2.5 text-[11px] text-aegis-text-muted">
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-aegis-danger" />
                  <span>{t('chat.effectiveTools.error')}</span>
                </div>
                <div className="break-words text-[10px] text-aegis-text-dim">{error}</div>
                <button
                  type="button"
                  onClick={() => { void refresh(); }}
                  className="rounded-md border border-aegis-border px-2 py-1 text-[10px] text-aegis-text-secondary transition-colors hover:border-aegis-border-hover hover:text-aegis-text"
                >
                  {t('chat.effectiveTools.retry')}
                </button>
              </div>
            )}

            {!loading && !error && result && (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-aegis-text-dim">
                  <span>{t('chat.effectiveTools.agent', { agentId: result.agentId })}</span>
                  <span>{t('chat.effectiveTools.profile', { profile: result.profile })}</span>
                  <span>{t('chat.effectiveTools.count', { count: total })}</span>
                </div>

                {result.notices?.map((notice) => (
                  <div
                    key={notice.id}
                    className={clsx(
                      'mb-2 rounded-md border px-2.5 py-2 text-[10px]',
                      notice.severity === 'warning'
                        ? 'border-aegis-warning/25 bg-aegis-warning/5 text-aegis-warning'
                        : 'border-aegis-border bg-[rgb(var(--aegis-overlay)/0.035)] text-aegis-text-muted',
                    )}
                  >
                    {notice.message}
                  </div>
                ))}

                {result.groups.length === 0 ? (
                  <div className="py-5 text-center text-[11px] text-aegis-text-dim">{t('chat.effectiveTools.empty')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {result.groups.map((group, index) => (
                      <details key={`${group.id}-${index}`} open={group.tools.length > 0} className="rounded-md border border-aegis-border">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-2 text-[11px] text-aegis-text-secondary [&::-webkit-details-marker]:hidden">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <ChevronDown size={12} className="shrink-0 text-aegis-text-dim" />
                            <span className="truncate">{group.label}</span>
                            <span className="text-[9px] text-aegis-text-dim">{t(`chat.effectiveTools.source.${SOURCE_KEYS[group.source]}`)}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[9px] text-aegis-text-dim">{group.tools.length}</span>
                        </summary>
                        <div className="border-t border-aegis-border px-2.5 py-1">
                          {group.tools.map((tool) => (
                            <div key={tool.id} className="border-b border-[rgb(var(--aegis-overlay)/0.05)] py-2 last:border-b-0">
                              <div className="flex items-start justify-between gap-2">
                                <span className="min-w-0 truncate text-[11px] font-medium text-aegis-text" title={tool.description}>{tool.label}</span>
                                <div className="flex shrink-0 items-center gap-1">
                                  {tool.risk && (
                                    <span className="text-[9px] text-aegis-text-dim">
                                      {t(`chat.effectiveTools.risk.${RISK_KEYS[tool.risk]}`)}
                                    </span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => selectTool(tool)}
                                    className="grid size-6 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-aegis-primary/10 hover:text-aegis-primary"
                                    title={t('chat.effectiveTools.invoke', { toolName: tool.id })}
                                    aria-label={t('chat.effectiveTools.invoke', { toolName: tool.id })}
                                  >
                                    <Play size={11} />
                                  </button>
                                </div>
                              </div>
                              <div className="mt-0.5 truncate font-mono text-[9px] text-aegis-text-dim" title={tool.id}>{tool.id}</div>
                            </div>
                          ))}
                        </div>
                      </details>
                    ))}
                  </div>
                )}

                {selectedTool && (
                  <div className="mt-3 rounded-md border border-aegis-primary/25 bg-aegis-primary/5 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-aegis-text">{t('chat.effectiveTools.invokeTitle')}</div>
                        <div className="mt-0.5 truncate font-mono text-[9px] text-aegis-text-dim" title={selectedTool.id}>{selectedTool.id}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setSelectedTool(null); setInvocation(null); setInvocationError(null); }}
                        className="grid size-6 shrink-0 place-items-center rounded-md text-aegis-text-dim transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.07)] hover:text-aegis-text"
                        title={t('chat.effectiveTools.invokeClose')}
                        aria-label={t('chat.effectiveTools.invokeClose')}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <label className="mt-2 block text-[10px] text-aegis-text-muted">
                      {t('chat.effectiveTools.invokeArgs')}
                      <textarea
                        value={argsText}
                        onChange={(event) => { setArgsText(event.target.value); setInvocationError(null); }}
                        rows={4}
                        spellCheck={false}
                        className="mt-1 block w-full resize-y rounded-md border border-aegis-border bg-[rgb(var(--aegis-overlay)/0.05)] px-2 py-1.5 font-mono text-[10px] leading-relaxed text-aegis-text outline-none focus:border-aegis-primary/50"
                        aria-label={t('chat.effectiveTools.invokeArgs')}
                      />
                    </label>
                    {invocationError && (
                      <div className="mt-2 flex items-start gap-1.5 text-[10px] text-aegis-danger">
                        <AlertCircle size={12} className="mt-0.5 shrink-0" />
                        <span className="break-words">{invocationError}</span>
                      </div>
                    )}
                    {invocation && (
                      <div className={clsx(
                        'mt-2 rounded-md border px-2 py-1.5 text-[10px]',
                        invocation.ok
                          ? 'border-aegis-success/25 bg-aegis-success/5 text-aegis-success'
                          : 'border-aegis-danger/25 bg-aegis-danger/5 text-aegis-danger',
                      )}>
                        <div className="flex items-center gap-1.5 font-medium">
                          {invocation.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          <span>{invocation.ok ? t('chat.effectiveTools.invokeSuccess') : t('chat.effectiveTools.invokeFailed')}</span>
                        </div>
                        {invocation.requiresApproval && <div className="mt-1">{t('chat.effectiveTools.invokeRequiresApproval')}</div>}
                        {invocation.error && <div className="mt-1 break-words">{invocation.error.code}: {invocation.error.message}</div>}
                        {invocation.ok && invocation.output !== undefined && (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-black/10 p-1.5 font-mono text-[9px] text-aegis-text">{formatToolOutput(invocation.output)}</pre>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={requestInvoke}
                      disabled={invoking}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-aegis-primary/30 bg-aegis-primary/10 px-2.5 py-1.5 text-[10px] font-semibold text-aegis-primary transition-colors hover:bg-aegis-primary/20 disabled:cursor-wait disabled:opacity-50"
                    >
                      {invoking ? <LoaderCircle size={12} className="animate-spin" /> : <Play size={12} />}
                      {invoking ? t('chat.effectiveTools.invokeRunning') : t('chat.effectiveTools.invokeConfirm')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="border-t border-aegis-menu-border px-3 py-2">
            <button
              type="button"
              onClick={onOpenConfiguration}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text-secondary"
            >
              <Settings2 size={12} />
              {t('chat.effectiveTools.openConfiguration')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
