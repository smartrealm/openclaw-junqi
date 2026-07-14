import i18n from '@/i18n';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { dataColorVar, themeColorVar } from '@/utils/theme-colors';
import { fmtCost } from './components';

type ChartPoint = {
  date: string;
  input: number;
  output: number;
  cache: number;
  other: number;
  total: number;
};

function CostTooltip({ active, payload, label }: any) {
  // Recharts conditionally mounts tooltip content, so avoid hooks here.
  if (!active || !payload?.length) return null;
  const tr = (k: string, d: string) => i18n.t(k, { defaultValue: d }) as string;
  const input = payload.find((p: any) => p.dataKey === 'input')?.value || 0;
  const output = payload.find((p: any) => p.dataKey === 'output')?.value || 0;
  const cache = payload.find((p: any) => p.dataKey === 'cache')?.value || 0;
  const other = payload.find((p: any) => p.dataKey === 'other')?.value || 0;
  const total = payload[0]?.payload?.total ?? input + output + cache + other;
  return (
    <div className="bg-aegis-card border border-aegis-border rounded-lg p-2.5 text-[12px] shadow-lg">
      <div className="text-aegis-text-dim font-mono mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5 text-aegis-accent">
        <span className="w-2 h-2 rounded-full bg-aegis-accent" />
        {tr('dashboard.input', 'Input')}: {fmtCost(input)}
      </div>
      <div className="flex items-center gap-1.5 text-aegis-primary">
        <span className="w-2 h-2 rounded-full bg-aegis-primary" />
        {tr('dashboard.output', 'Output')}: {fmtCost(output)}
      </div>
      {cache > 0 && (
        <div className="flex items-center gap-1.5 text-aegis-success">
          <span className="w-2 h-2 rounded-full bg-aegis-success" />
          {tr('dashboard.cacheCostLabel', 'Cache')}: {fmtCost(cache)}
        </div>
      )}
      {other > 0 && (
        <div className="flex items-center gap-1.5 text-aegis-text-muted">
          <span className="w-2 h-2 rounded-full bg-aegis-text-muted" />
          {tr('dashboard.otherCostLabel', 'Other')}: {fmtCost(other)}
        </div>
      )}
      <div className="text-aegis-text font-semibold mt-1.5 pt-1.5 border-t border-[rgb(var(--aegis-overlay)/0.06)]">
        {tr('dashboard.total', 'Total')}: {fmtCost(total)}
      </div>
    </div>
  );
}

export function CostChart({ data }: { data: ChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="gInput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={themeColorVar('accent')} stopOpacity={0.25} />
            <stop offset="100%" stopColor={themeColorVar('accent')} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gOutput" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={themeColorVar('primary')} stopOpacity={0.25} />
            <stop offset="100%" stopColor={themeColorVar('primary')} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--aegis-overlay) / 0.04)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'rgb(var(--aegis-text-dim))' }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: 'rgb(var(--aegis-text-dim))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (v === 0 ? '' : `$${v.toFixed(2)}`)}
        />
        <Tooltip content={<CostTooltip />} cursor={{ stroke: 'rgb(var(--aegis-overlay) / 0.06)' }} />
        <Area type="monotone" dataKey="input" stackId="1" stroke={themeColorVar('accent')} strokeWidth={1.5} fill="url(#gInput)" isAnimationActive={false} />
        <Area type="monotone" dataKey="output" stackId="1" stroke={themeColorVar('primary')} strokeWidth={1.5} fill="url(#gOutput)" isAnimationActive={false} />
        <Area type="monotone" dataKey="cache" stackId="1" stroke={themeColorVar('success')} strokeWidth={1.5} fillOpacity={0.18} fill={themeColorVar('success')} isAnimationActive={false} />
        <Area type="monotone" dataKey="other" stackId="1" stroke={dataColorVar(9)} strokeWidth={1.5} fillOpacity={0.12} fill={dataColorVar(9)} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
