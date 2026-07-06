// ═══════════════════════════════════════════════════════════
// ChartTooltip — Shared Recharts tooltip for cost/token charts
// ═══════════════════════════════════════════════════════════

import { formatTokens, formatUsd } from '../helpers';
import i18n from '@/i18n';

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string; payload?: { cost?: number } }>;
  label?: string;
}

export const ChartTooltip = ({ active, payload, label }: TooltipProps) => {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0);
  const total = payload[0]?.payload?.cost;

  return (
    <div
      className="border border-[rgb(var(--aegis-overlay)/0.1)] rounded-xl px-3 py-2 text-[11px]"
      style={{
        background: 'var(--aegis-bg-frosted)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 8px 32px rgb(var(--aegis-overlay) / 0.15)',
      }}
    >
      <div className="text-aegis-text-muted mb-1 font-mono">{label}</div>
      {rows.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-aegis-text-muted">{p.name}:</span>
          <span className="text-aegis-text font-mono font-bold">
            {p.name.toLowerCase().includes('token')
              ? formatTokens(p.value)
              : formatUsd(p.value)}
          </span>
        </div>
      ))}
      {typeof total === 'number' && (
        <div className="mt-1.5 border-t border-[rgb(var(--aegis-overlay)/0.08)] pt-1.5 flex items-center justify-between gap-4">
          <span className="text-aegis-text-muted">{i18n.t('analytics.total', 'Total')}:</span>
          <span className="text-aegis-text font-mono font-bold">{formatUsd(total)}</span>
        </div>
      )}
    </div>
  );
};
