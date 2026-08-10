import { CircleUserRound, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

function initials(name: string | null): string {
  return name?.trim().slice(0, 2).toUpperCase() || 'DWS';
}

export function DingTalkRuntimeIdentity({
  runtime,
  mode = 'compact',
}: {
  runtime: DingTalkRuntimeIdentityProjection | null;
  mode?: 'compact' | 'full';
}) {
  const { t } = useTranslation();
  if (!runtime) {
    return mode === 'full'
      ? <div className="flex min-h-32 items-center justify-center border border-dashed border-aegis-border px-4 text-center text-[10.5px] text-aegis-text-dim">{t('businessApplications.runtimeIdentity.notReadFull')}</div>
      : <span className="text-[9.5px] text-aegis-text-dim">{t('businessApplications.runtimeIdentity.notRead')}</span>;
  }
  const current = runtime.profiles.find((profile) => profile.isCurrent) ?? runtime.profiles.find((profile) => profile.profile === runtime.currentProfile);
  const user = runtime.user;
  const avatar = user?.avatarUrl ? (
    <img className="h-9 w-9 rounded-md border border-aegis-border object-cover" src={user.avatarUrl} alt={t('businessApplications.runtimeIdentity.avatarAlt')} />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-primary/25 bg-aegis-primary/10 text-[9px] font-semibold text-aegis-primary">{initials(user?.name ?? null)}</span>
  );

  if (mode === 'full') {
    return (
      <div className="border border-aegis-border bg-aegis-surface/45">
        <div className="flex items-center gap-3 border-b border-aegis-border px-3 py-3">
          {avatar}
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold text-aegis-text">{user?.name ?? current?.userName ?? t('businessApplications.runtimeIdentity.userPending')}</div>
            <div className="mt-0.5 truncate text-[10px] text-aegis-text-dim">{user?.organization ?? current?.corpName ?? t('businessApplications.runtimeIdentity.organizationPending')}</div>
          </div>
        </div>
        <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-y-2 px-3 py-3 text-[10px]">
          <dt className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.currentProfile')}</dt>
          <dd className="truncate font-mono text-aegis-text-secondary" title={current?.profile ?? runtime.currentProfile ?? undefined}>{current?.profile ?? runtime.currentProfile ?? t('businessApplications.runtimeIdentity.notReturned')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.identityStatus')}</dt>
          <dd className={current ? 'text-aegis-success' : 'text-aegis-warning'}>{current?.status ?? t(runtime.available ? 'businessApplications.runtimeIdentity.pending' : 'businessApplications.runtimeIdentity.unavailable')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.department')}</dt>
          <dd className="text-aegis-text-secondary">{user?.department ?? t('businessApplications.runtimeIdentity.notReturned')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.expiresAt')}</dt>
          <dd className="text-aegis-text-secondary">{current?.expiresAt ?? t('businessApplications.runtimeIdentity.notReturned')}</dd>
          <dt className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.authorizedDomains')}</dt>
          <dd className="flex flex-wrap gap-1">
            {current?.authorizedDomains.length
              ? current.authorizedDomains.map((domain) => <span key={domain} className="border border-aegis-success/25 bg-aegis-success/[0.06] px-1.5 py-0.5 text-[9px] text-aegis-success">{domain}</span>)
              : <span className="text-aegis-text-dim">{t('businessApplications.runtimeIdentity.domainsNotReturned')}</span>}
          </dd>
        </dl>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg/55 px-2 py-1.5" title={current?.profile ?? undefined}>
      {user?.avatarUrl ? (
        <img className="h-6 w-6 rounded-full border border-aegis-border object-cover" src={user.avatarUrl} alt={t('businessApplications.runtimeIdentity.avatarAlt')} />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-aegis-primary/25 bg-aegis-primary/10 text-[8px] font-semibold text-aegis-primary">{initials(user?.name ?? null)}</span>
      )}
      <div className="hidden min-w-0 leading-3.5 lg:block">
        <div className="flex items-center gap-1 text-[10px] font-medium text-aegis-text-secondary"><CircleUserRound size={10} />{user?.name ?? current?.userName ?? t('businessApplications.runtimeIdentity.userPending')}</div>
        <div className="truncate text-[9px] text-aegis-text-dim">{user?.organization ?? current?.corpName ?? current?.profile ?? t('businessApplications.runtimeIdentity.profileMissing')}</div>
      </div>
      {current && <span className="ml-auto hidden shrink-0 items-center gap-1 text-[9px] text-aegis-success 2xl:flex" title={current.authorizedDomains.length ? t('businessApplications.runtimeIdentity.domainsTitle', { domains: current.authorizedDomains.join(', ') }) : t('businessApplications.runtimeIdentity.domainsNotReturned')}><ShieldCheck size={10} />{current.status ?? t('businessApplications.runtimeIdentity.read')}</span>}
    </div>
  );
}
