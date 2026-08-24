import { cn } from '@/lib/utils';

type AgentOfficeCharacterState = 'active' | 'waiting' | 'attention' | 'completed' | 'configured';
type AgentOfficeFurnitureKind = 'coordination' | 'active' | 'waiting' | 'attention' | 'completed';

function characterVariant(agentId: string): number {
  let value = 0;
  for (const character of agentId) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value % 3;
}

export function AgentOfficeCharacter({
  agentId,
  state,
  coordinator = false,
  className,
}: {
  agentId: string;
  state: AgentOfficeCharacterState;
  coordinator?: boolean;
  className?: string;
}) {
  const variant = characterVariant(agentId);
  const busy = state === 'active';
  const settled = state === 'completed';
  const alert = state === 'attention';
  const resting = state === 'waiting' || state === 'configured';

  return (
    <svg
      viewBox="0 0 64 72"
      className={cn('shrink-0 text-current', className)}
      shapeRendering="crispEdges"
      role="presentation"
      aria-hidden="true"
    >
      <rect x="8" y="60" width="48" height="4" fill="currentColor" opacity="0.18" />
      <rect x="16" y="28" width="32" height="28" rx="2" fill="currentColor" opacity="0.82" />
      <rect x="20" y="24" width="24" height="4" fill="currentColor" opacity="0.56" />
      <rect x="18" y="14" width="28" height="20" rx="2" fill="currentColor" opacity="0.94" />
      <rect x="22" y="18" width="20" height="12" fill="rgb(var(--aegis-surface-solid))" opacity="0.94" />
      <rect x={variant === 0 ? '25' : variant === 1 ? '22' : '30'} y="21" width="4" height="4" fill="currentColor" />
      <rect x={variant === 0 ? '35' : variant === 1 ? '37' : '30'} y="21" width="4" height="4" fill="currentColor" />
      {variant === 1 && <rect x="27" y="27" width="10" height="2" fill="currentColor" opacity="0.64" />}
      {variant === 2 && <rect x="27" y="26" width="10" height="2" fill="currentColor" opacity="0.64" />}
      <rect x="28" y="8" width="8" height="6" fill="currentColor" opacity="0.68" />
      <rect x="31" y="4" width="2" height="4" fill="currentColor" opacity="0.68" />
      {coordinator && (
        <>
          <path d="M18 13h28l-4 8-10-4-10 4z" fill="currentColor" opacity="0.64" />
          <rect x="30" y="10" width="4" height="4" fill="rgb(var(--aegis-surface-solid))" opacity="0.88" />
        </>
      )}
      <rect x="10" y="34" width="6" height="14" fill="currentColor" opacity="0.62" />
      <rect x="48" y="34" width="6" height="14" fill="currentColor" opacity="0.62" />
      <rect x="20" y="56" width="8" height="6" fill="currentColor" opacity="0.72" />
      <rect x="36" y="56" width="8" height="6" fill="currentColor" opacity="0.72" />
      {busy && <rect x="50" y="12" width="6" height="6" fill="currentColor" opacity="0.56" />}
      {resting && <rect x="48" y="18" width="8" height="2" fill="currentColor" opacity="0.42" />}
      {settled && <path d="M51 14l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" />}
      {alert && <><rect x="51" y="11" width="6" height="10" fill="currentColor" opacity="0.72" /><rect x="53" y="13" width="2" height="4" fill="rgb(var(--aegis-surface-solid))" /><rect x="53" y="18" width="2" height="2" fill="rgb(var(--aegis-surface-solid))" /></>}
    </svg>
  );
}

export function AgentOfficeFurniture({
  kind,
  className,
}: {
  kind: AgentOfficeFurnitureKind;
  className?: string;
}) {
  const screen = kind === 'active' || kind === 'coordination';
  const cabinet = kind === 'completed';
  const alert = kind === 'attention';

  return (
    <svg
      viewBox="0 0 112 64"
      className={cn('text-current', className)}
      shapeRendering="crispEdges"
      role="presentation"
      aria-hidden="true"
    >
      <rect x="4" y="48" width="104" height="4" fill="currentColor" opacity="0.18" />
      <rect x="16" y="36" width="68" height="8" fill="currentColor" opacity="0.44" />
      <rect x="20" y="44" width="5" height="12" fill="currentColor" opacity="0.42" />
      <rect x="75" y="44" width="5" height="12" fill="currentColor" opacity="0.42" />
      {screen && <><rect x="38" y="10" width="28" height="21" fill="currentColor" opacity="0.48" /><rect x="42" y="14" width="20" height="13" fill="rgb(var(--aegis-surface-solid))" opacity="0.72" /><rect x="49" y="31" width="6" height="5" fill="currentColor" opacity="0.42" /></>}
      {kind === 'waiting' && <><rect x="38" y="20" width="25" height="12" fill="currentColor" opacity="0.35" /><rect x="42" y="16" width="17" height="4" fill="currentColor" opacity="0.28" /><rect x="86" y="28" width="10" height="10" fill="currentColor" opacity="0.32" /><rect x="88" y="24" width="6" height="4" fill="currentColor" opacity="0.32" /></>}
      {cabinet && <><rect x="88" y="12" width="16" height="36" fill="currentColor" opacity="0.42" /><rect x="91" y="16" width="10" height="3" fill="rgb(var(--aegis-surface-solid))" opacity="0.72" /><rect x="91" y="26" width="10" height="3" fill="rgb(var(--aegis-surface-solid))" opacity="0.72" /><rect x="91" y="36" width="10" height="3" fill="rgb(var(--aegis-surface-solid))" opacity="0.72" /></>}
      {alert && <><path d="M91 14l12 22H79z" fill="currentColor" opacity="0.54" /><rect x="90" y="21" width="2" height="7" fill="rgb(var(--aegis-surface-solid))" opacity="0.84" /><rect x="90" y="30" width="2" height="2" fill="rgb(var(--aegis-surface-solid))" opacity="0.84" /></>}
    </svg>
  );
}
