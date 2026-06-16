// Context notice — global session context usage indicator.
// Renders ABOVE the chat input, mirrors openclaw web UI design.
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Minimize2, AlertCircle, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { gateway } from '@/services/gateway';
import clsx from 'clsx';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0).replace(/\.0$/, '')}k`;
  return String(n);
}

export function ContextNotice() {
  const { t } = useTranslation();
  const { tokenUsage, activeSessionKey, connected } = useChatStore();
  const [compacting, setCompacting] = useState(false);

  const used = tokenUsage?.contextTokens ?? 0;
  const limit = tokenUsage?.maxTokens ?? 0;
  if (limit === 0) return null;

  const pct = Math.min(Math.round((used / limit) * 100), 100);
  const warning = pct >= 85;
  const recommendCompact = pct >= 90;

  const handleCompact = useCallback(async () => {
    if (!activeSessionKey || !connected || compacting) return;
    setCompacting(true);
    try {
      await gateway.call('sessions.reset', { sessionKey: activeSessionKey });
    } catch { /* silent */ }
    finally { setCompacting(false); }
  }, [activeSessionKey, connected, compacting]);

  return (
    <div
      role="status"
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px] font-mono transition-colors',
        warning
          ? 'bg-amber-500/10 border border-amber-500/25 text-amber-300'
          : 'bg-[rgb(var(--aegis-overlay)/0.04)] border border-aegis-border/30 text-aegis-text-muted'
      )}
      title={t('chat.contextTitle', 'Session context usage')}
    >
      {warning ? <AlertCircle size={12} className="shrink-0" /> : <Minimize2 size={12} className="shrink-0" />}
      <span className="font-medium text-aegis-text">{pct}%</span>
      <span className="text-aegis-text-dim">context used</span>
      <span className="text-aegis-text-dim">{fmtTokens(used)} / {fmtTokens(limit)}</span>
      <div className="flex-1 h-1.5 rounded-full bg-[rgb(var(--aegis-overlay)/0.08)] overflow-hidden mx-1 min-w-[40px]">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {recommendCompact && (
        <button
          onClick={handleCompact}
          disabled={compacting || !connected}
          className={clsx(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all',
            'bg-amber-500/15 text-amber-300 border border-amber-500/30',
            'hover:bg-amber-500/25 disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          {compacting ? <Loader2 size={10} className="animate-spin" /> : <Minimize2 size={10} />}
          <span>{compacting ? t('chat.compacting', '压缩中…') : t('chat.compact', '压缩')}</span>
        </button>
      )}
    </div>
  );
}

export default ContextNotice;
