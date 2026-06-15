// Context notice bar — 1:1 mirror of openclaw/ui/src/ui/chat/context-notice.ts.
// Renders as a full-width row below an assistant message showing token usage,
// progress meter, and a compact button when the ratio reaches the threshold.
import { Minimize2, TriangleAlert, Loader2 } from 'lucide-react';

const CONTEXT_COMPACT_RATIO = 0.9;
const CONTEXT_WARN_RATIO = 0.85;

export interface ContextNoticeViewModel {
  percentage: number;
  used: number;
  limit: number;
  warning: boolean;
  compactRecommended: boolean;
}

function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

function getWarningColor(ratio: number): { color: string; bg: string } {
  // Interpolate amber→red as ratio goes from 0.85 to 0.95
  const t = Math.min(Math.max((ratio - 0.85) / 0.1, 0), 1);
  const r = Math.round(245 + (239 - 245) * t);
  const g = Math.round(158 + (68 - 158) * t);
  const b = Math.round(11 + (68 - 11) * t);
  const alpha = 0.08 + 0.08 * t;
  return {
    color: `rgb(${r},${g},${b})`,
    bg: `rgba(${r},${g},${b},${alpha})`,
  };
}

export interface ContextNoticeProps {
  /** Token snapshot stored on the message block. */
  viewModel: ContextNoticeViewModel;
  /** Called when the user clicks "Compact" (ratio >= 90%). */
  onCompact?: () => void;
  /** Show a busy spinner on the compact button. */
  compactBusy?: boolean;
}

export function ContextNotice({ viewModel, onCompact, compactBusy }: ContextNoticeProps) {
  const { percentage, used, limit, warning, compactRecommended } = viewModel;
  const detail = `${formatTokensCompact(used)} / ${formatTokensCompact(limit)}`;
  const canCompact = compactRecommended && onCompact;
  const warnColors = warning ? getWarningColor(used / limit) : null;
  const style = warnColors
    ? { color: warnColors.color, background: warnColors.bg }
    : { color: 'rgb(var(--aegis-text-muted))', background: 'rgb(var(--aegis-overlay) / 0.06)' };

  return (
    <div
      className="flex items-center gap-2 px-3 py-1 text-[10px] select-none"
      style={style}
      role="status"
      title={`Session context usage: ${detail} (${percentage}%)`}
    >
      {warning ? (
        <TriangleAlert size={12} className="shrink-0" />
      ) : (
        <div className="h-1 flex-1 min-w-[40px] rounded-full overflow-hidden" style={{ background: 'currentColor', opacity: 0.12 }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${percentage}%`, background: 'currentColor', opacity: 0.8 }}
          />
        </div>
      )}
      <span className="whitespace-nowrap">{percentage}% context used</span>
      <span className="whitespace-nowrap" style={{ opacity: 0.6 }}>{detail}</span>
      {canCompact && (
        <button
          onClick={onCompact}
          disabled={compactBusy}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors hover:brightness-110 disabled:opacity-50"
          style={{ background: 'currentColor', opacity: 0.12 }}
          title="Compact session context"
        >
          {compactBusy ? <Loader2 size={10} className="animate-spin" /> : <Minimize2 size={10} />}
          <span>{compactBusy ? 'Compacting' : 'Compact'}</span>
        </button>
      )}
    </div>
  );
}
