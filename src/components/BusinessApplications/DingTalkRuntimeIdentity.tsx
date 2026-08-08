import { CircleUserRound, ShieldCheck } from 'lucide-react';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

function initials(name: string | null): string {
  return name?.trim().slice(0, 2).toUpperCase() || 'DWS';
}

export function DingTalkRuntimeIdentity({ runtime }: { runtime: DingTalkRuntimeIdentityProjection | null }) {
  if (!runtime) return <span className="text-[9.5px] text-aegis-text-dim">未读取 DWS 身份</span>;
  const current = runtime.profiles.find((profile) => profile.isCurrent) ?? runtime.profiles.find((profile) => profile.profile === runtime.currentProfile);
  const user = runtime.user;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg/55 px-2 py-1.5" title={current?.profile ?? undefined}>
      {user?.avatarUrl ? (
        <img className="h-6 w-6 rounded-full border border-aegis-border object-cover" src={user.avatarUrl} alt="DWS 当前用户头像" />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-aegis-primary/25 bg-aegis-primary/10 text-[8px] font-semibold text-aegis-primary">{initials(user?.name ?? null)}</span>
      )}
      <div className="min-w-0 leading-3.5">
        <div className="flex items-center gap-1 text-[10px] font-medium text-aegis-text-secondary"><CircleUserRound size={10} />{user?.name ?? current?.userName ?? '当前用户待验证'}</div>
        <div className="truncate text-[9px] text-aegis-text-dim">{user?.organization ?? current?.corpName ?? current?.profile ?? '未找到当前 profile'}</div>
      </div>
      {current && <span className="ml-auto flex shrink-0 items-center gap-1 text-[9px] text-aegis-success" title={current.authorizedDomains.length ? `授权域：${current.authorizedDomains.join('、')}` : 'DWS 未报告授权域'}><ShieldCheck size={10} />{current.status ?? '已读取'}</span>}
    </div>
  );
}
