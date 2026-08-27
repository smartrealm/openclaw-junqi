import { cn } from '@/lib/utils';

type AgentOfficeCharacterState = 'active' | 'waiting' | 'attention' | 'completed' | 'configured';
type AgentOfficeFurnitureKind = 'coordination' | 'active' | 'waiting' | 'attention' | 'completed';

function characterVariant(agentId: string): number {
  let value = 0;
  for (const character of agentId) value = (value * 31 + character.charCodeAt(0)) >>> 0;
  return value % 3;
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

/**
 * 工位场景：角色坐在桌子后面的组合视图，取代此前"家具背景装饰 + 独立头像图标"
 * 两者互不关联的呈现方式。每张 Agent 卡片使用这一个场景，让"工位"在视觉上
 * 真正成立，而不是一个贴了机器人图标的联系人列表项。
 */
export function AgentOfficeDeskScene({
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
      viewBox="0 0 96 80"
      className={cn('shrink-0 text-current', className)}
      shapeRendering="crispEdges"
      role="presentation"
      aria-hidden="true"
    >
      {/* 地面阴影 */}
      <rect x="8" y="74" width="80" height="3" fill="currentColor" opacity="0.12" />

      {/* 显示器（桌面后方，角色身前） */}
      <rect x="34" y="18" width="28" height="20" fill="currentColor" opacity="0.46" />
      <rect x="38" y="22" width="20" height="12" fill="rgb(var(--aegis-surface-solid))" opacity="0.9" />
      <rect x="45" y="38" width="6" height="4" fill="currentColor" opacity="0.4" />
      {busy && <rect x="41" y="25" width="14" height="6" fill="currentColor" opacity="0.5" />}
      {resting && <rect x="41" y="26" width="14" height="2" fill="currentColor" opacity="0.3" />}
      {settled && <path d="M43 28l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.65" />}
      {alert && <rect x="46" y="24" width="4" height="6" fill="currentColor" opacity="0.55" />}

      {/* 角色（坐姿，头肩部露出在显示器上方与两侧） */}
      <rect x="28" y="4" width="8" height="6" fill="currentColor" opacity="0.68" />
      <rect x="31" y="0" width="2" height="4" fill="currentColor" opacity="0.68" />
      <rect x="26" y="10" width="20" height="14" rx="2" fill="currentColor" opacity="0.94" />
      <rect x="30" y="14" width="12" height="8" fill="rgb(var(--aegis-surface-solid))" opacity="0.94" />
      <rect x={variant === 0 ? '32' : variant === 1 ? '30' : '36'} y="16" width="3" height="3" fill="currentColor" />
      <rect x={variant === 0 ? '38' : variant === 1 ? '39' : '36'} y="16" width="3" height="3" fill="currentColor" />
      {coordinator && (
        <>
          <path d="M27 9h18l-3 5-6-2-6 2z" fill="currentColor" opacity="0.66" />
          <rect x="35" y="7" width="3" height="3" fill="rgb(var(--aegis-surface-solid))" opacity="0.9" />
        </>
      )}
      <rect x="20" y="20" width="10" height="16" rx="1" fill="currentColor" opacity="0.8" />
      <rect x="42" y="20" width="10" height="16" rx="1" fill="currentColor" opacity="0.8" />

      {/* 办公桌（前景，遮挡角色下半身，制造"坐在桌后"的空间关系） */}
      <rect x="6" y="40" width="84" height="7" fill="currentColor" opacity="0.5" />
      <rect x="10" y="47" width="6" height="24" fill="currentColor" opacity="0.42" />
      <rect x="80" y="47" width="6" height="24" fill="currentColor" opacity="0.42" />
      <rect x="20" y="47" width="56" height="18" fill="currentColor" opacity="0.16" />

      {/* 桌面点缀：随状态变化 */}
      {busy && <rect x="66" y="42" width="14" height="4" fill="currentColor" opacity="0.4" />}
      {settled && <rect x="18" y="42" width="12" height="4" fill="currentColor" opacity="0.34" />}
      {alert && <rect x="66" y="41" width="6" height="6" fill="currentColor" opacity="0.5" />}
      {resting && <rect x="18" y="43" width="10" height="3" fill="currentColor" opacity="0.28" />}
    </svg>
  );
}
