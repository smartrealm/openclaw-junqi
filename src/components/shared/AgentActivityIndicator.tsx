import clsx from 'clsx';
import { ThinkingOrb, type OrbState, type OrbTheme } from 'thinking-orbs';
import { useResolvedTheme } from '@/theme/useTheme';
import type { AegisTheme } from '@/theme/types';

export type AgentActivity = 'thinking' | 'generating' | 'working' | 'listening';

interface AgentActivityIndicatorBaseProps {
  activity: AgentActivity;
  size?: 20 | 64;
  paused?: boolean;
  className?: string;
}

export type AgentActivityIndicatorProps = AgentActivityIndicatorBaseProps & (
  | { decorative: true; label?: never }
  | { decorative?: false; label: string }
);

const ACTIVITY_ORBS: Record<AgentActivity, OrbState> = {
  thinking: 'breathing',
  generating: 'composing',
  working: 'working',
  listening: 'listening',
};

export function activityOrbState(activity: AgentActivity): OrbState {
  return ACTIVITY_ORBS[activity];
}

export function activityOrbTheme(theme: AegisTheme): OrbTheme {
  return theme === 'aegis-dark' || theme === 'aegis-midnight' ? 'dark' : 'light';
}

/** Agent-only activity glyph. Generic loading states continue to use LoadingIndicator. */
export function AgentActivityIndicator({
  activity,
  size = 20,
  label,
  decorative = false,
  paused = false,
  className,
}: AgentActivityIndicatorProps) {
  const resolvedTheme = useResolvedTheme();
  const accessibilityProps = decorative
    ? { 'aria-hidden': true as const, role: 'presentation' as const }
    : { role: 'status' as const, 'aria-label': label, 'aria-live': 'polite' as const };

  return (
    <span
      {...accessibilityProps}
      className={clsx('aegis-agent-activity-indicator', className)}
      data-agent-activity={activity}
      style={{ width: size, height: size }}
    >
      <ThinkingOrb
        state={activityOrbState(activity)}
        size={size}
        theme={activityOrbTheme(resolvedTheme)}
        paused={paused}
        aria-hidden="true"
        role="presentation"
      />
    </span>
  );
}
