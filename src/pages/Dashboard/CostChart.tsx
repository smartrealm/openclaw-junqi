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
import { formatTokens } from '@/utils/format';

type ChartPoint = {
  date: string;
  input: number;
  output: number;
  cache: number;
  other: number;
  total: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
};

type ChartMetric = 'cost' | 'tokens';

function CostTooltip({ active, payload, label, metric }: any) {
  // Recharts conditionally mounts tooltip content, so avoid hooks here.
  if (!active || !payload?.length) return null;
  const tr = (k: string, d: string) => i18n.t(k, { defaultValue: d }) as string;
  const tokenMode = metric === 'tokens';
  const input = payload.find((p: any) => p.dataKey === (tokenMode ? 'inputTokens' : 'input'))?.value || 0;
  const output = payload.find((p: any) => p.dataKey === (tokenMode ? 'outputTokens' : 'output'))?.value || 0;
  const cache = payload.find((p: any) => p.dataKey === (tokenMode ? 'cacheTokens' : 'cache'))?.value || 0;
  const other = tokenMode ? 0 : payload.find((p: any) => p.dataKey === 'other')?.value || 0;
  const total = payload[0]?.payload?.[tokenMode ? 'totalTokens' : 'total'] ?? input + output + cache + other;
  const format = tokenMode ? formatTokens : fmtCost;
  return (
    <div className="bg-aegis-card border border-aegis-border rounded-lg p-2.5 text-[12px] shadow-lg">
      <div className="text-aegis-text-dim font-mono mb-1.5">{label}</div>
      <div className="flex items-center gap-1.5 text-aegis-accent">
        <span className="w-2 h-2 rounded-full bg-aegis-accent" />
        {tr('dashboard.input', 'Input')}: {format(input)}
      </div>
      <div className="flex items-center gap-1.5 text-aegis-primary">
        <span className="w-2 h-2 rounded-full bg-aegis-primary" />
        {tr('dashboard.output', 'Output')}: {format(output)}
      </div>
      {cache > 0 && (
        <div className="flex items-center gap-1.5 text-aegis-success">
          <span className="w-2 h-2 rounded-full bg-aegis-success" />
          {tr(tokenMode ? 'dashboard.cacheTokenLabel' : 'dashboard.cacheCostLabel', 'Cache')}: {format(cache)}
        </div>
      )}
      {!tokenMode && other > 0 && (
        <div className="flex items-center gap-1.5 text-aegis-text-muted">
          <span className="w-2 h-2 rounded-full bg-aegis-text-muted" />
        {tr('dashboard.otherCostLabel', 'Other')}: {fmtCost(other)}
        </div>
      )}
      <div className="text-aegis-text font-semibold mt-1.5 pt-1.5 border-t border-[rgb(var(--aegis-overlay)/0.06)]">
        {tr('dashboard.total', 'Total')}: {format(total)}
      </div>
    </div>
  );
}

export function CostChart({ data, metric = 'cost' }: { data: ChartPoint[]; metric?: ChartMetric }) {
  const tokenMode = metric === 'tokens';
  return (
    <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
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
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'rgb(var(--aegis-text-dim))' }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 11, fill: 'rgb(var(--aegis-text-dim))' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => (v === 0 ? '' : tokenMode ? formatTokens(v) : `$${v.toFixed(2)}`)}
        />
        <Tooltip content={<CostTooltip metric={metric} />} cursor={{ stroke: 'rgb(var(--aegis-overlay) / 0.06)' }} />
        <Area type="monotone" dataKey={tokenMode ? 'inputTokens' : 'input'} stackId="1" stroke={themeColorVar('accent')} strokeWidth={1.5} fill="url(#gInput)" isAnimationActive={false} />
        <Area type="monotone" dataKey={tokenMode ? 'outputTokens' : 'output'} stackId="1" stroke={themeColorVar('primary')} strokeWidth={1.5} fill="url(#gOutput)" isAnimationActive={false} />
        <Area type="monotone" dataKey={tokenMode ? 'cacheTokens' : 'cache'} stackId="1" stroke={themeColorVar('success')} strokeWidth={1.5} fillOpacity={0.18} fill={themeColorVar('success')} isAnimationActive={false} />
        {!tokenMode && <Area type="monotone" dataKey="other" stackId="1" stroke={dataColorVar(9)} strokeWidth={1.5} fillOpacity={0.12} fill={dataColorVar(9)} isAnimationActive={false} />}
      </AreaChart>
    </ResponsiveContainer>
  );
}
