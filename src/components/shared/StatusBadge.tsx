// 状态徽标统一呈现会话与活动记录共用的生命周期状态。

import type { ReactNode } from 'react';
import { Circle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { LoadingIndicator } from './LoadingIndicator';
import {
  resolveStatusTone,
  statusToneColor,
  statusToneGlow,
  toneAnimatesByDefault,
} from './status/statusTone';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';

/** 生命周期词汇由该模块公开，颜色映射统一委托给 `resolveStatusTone`。 */
export type LifecycleState = 'idle' | 'running' | 'attention' | 'failed' | 'ended';

export interface StatusBadgeProps {
  state: LifecycleState;
  /** 是否在图标旁显示文字，默认仅显示图标。 */
  label?: boolean;
  /** 图标尺寸，默认 8 像素。 */
  size?: number;
  /** 可选的显示文字覆盖值。 */
  labelText?: string;
  /** 根元素附加样式。 */
  className?: string;
  /** 是否显示运行中的脉冲反馈，未指定时遵循共享状态色规则。 */
  pulse?: boolean;
}

/** 生命周期状态决定图形，颜色来自共享状态色表。 */
const STATE_GLYPH: Record<LifecycleState, 'spinner' | 'alert' | 'check' | 'dot'> = {
  idle: 'dot',
  running: 'spinner',
  attention: 'alert',
  failed: 'alert',
  ended: 'check',
};

const STATE_I18N: Record<LifecycleState, { key: string; fallback: string }> = {
  idle: { key: 'lifecycle.idle', fallback: 'idle' },
  running: { key: 'lifecycle.running', fallback: 'running' },
  attention: { key: 'lifecycle.attention', fallback: 'attention' },
  failed: { key: 'lifecycle.failed', fallback: 'failed' },
  ended: { key: 'lifecycle.ended', fallback: 'done' },
};

export function StatusBadge({
  state,
  label = false,
  size = 8,
  labelText,
  className,
  pulse,
}: StatusBadgeProps) {
  const { t } = useTranslation();
  const tone = resolveStatusTone(state);
  const color = statusToneColor(tone);
  const glow = statusToneGlow(tone);
  const copy = STATE_I18N[state];
  const shouldPulse = pulse ?? toneAnimatesByDefault(tone);
  const glyphSize = Math.max(size + 2, 10);

  let Glyph: ReactNode;
  switch (STATE_GLYPH[state]) {
    case 'spinner':
      Glyph = <LoadingIndicator size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    case 'alert':
      Glyph = <AlertCircle size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    case 'check':
      Glyph = <CheckCircle2 size={glyphSize} className="shrink-0" style={{ color }} />;
      break;
    default:
      Glyph = <Circle size={size} className="shrink-0" style={{ color, fill: color }} />;
  }

  return (
    <span
      className={clsx('inline-flex items-center gap-1.5 shrink-0', className)}
      style={shouldPulse ? { filter: `drop-shadow(0 0 4px ${glow})` } : undefined}
      title={t(copy.key, copy.fallback)}
      aria-label={t(copy.key, copy.fallback)}
    >
      {Glyph}
      {label && (
        <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color }}>
          {labelText ?? t(copy.key, copy.fallback)}
        </span>
      )}
    </span>
  );
}

/**
 * 标签栏与列表行使用的紧凑状态点直接复用共享 Aegis 原语，避免重复维护颜色与状态映射。
 */
export { StatusDot } from './badge';
