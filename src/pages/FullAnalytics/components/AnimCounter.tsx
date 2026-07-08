// ═══════════════════════════════════════════════════════════
// AnimCounter — formatted number display
// ═══════════════════════════════════════════════════════════

interface AnimCounterProps {
  value: number | string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  color: string;
}

export function AnimCounter({
  value,
  prefix = '',
  suffix = '',
  decimals = 2,
  color,
}: AnimCounterProps) {
  const display =
    typeof value === 'number'
      ? decimals > 0
        ? value.toFixed(decimals)
        : value.toLocaleString()
      : value;

  return (
    <span
      className="text-[28px] font-black font-mono tracking-tight leading-none"
      style={{ color }}
    >
      {prefix}{display}{suffix}
    </span>
  );
}
