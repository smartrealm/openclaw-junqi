import { ShieldCheck, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';
import {
  resolveDwsAvatarUrl,
  resolveDwsIdentitySecondaryLabel,
} from '@/business-applications/dwsProfileSelection';
import { Button } from '@/components/shared/button/Button';

export function DingTalkRuntimeIdentity({
  runtime,
  mode = 'compact',
  selectedProfile = '',
  operationActive = false,
  onSelectedProfileChange,
  onSwitchProfile,
  onLogoutProfile,
}: {
  runtime: DingTalkRuntimeIdentityProjection | null;
  mode?: 'compact' | 'full';
  selectedProfile?: string;
  operationActive?: boolean;
  onSelectedProfileChange?: (profile: string) => void;
  onSwitchProfile?: (profile: string) => void;
  onLogoutProfile?: (profile: string) => void;
}) {
  const { t } = useTranslation();
  if (!runtime) {
    return mode === 'full'
      ? <div className="flex min-h-32 items-center justify-center border border-dashed border-aegis-border px-4 text-center text-[10.5px] text-aegis-text-dim">{t('businessApplications.runtimeIdentity.notReadFull')}</div>
      : <span className="text-[9.5px] text-aegis-text-dim">{t('businessApplications.runtimeIdentity.notRead')}</span>;
  }
  const current = runtime.profiles.find((profile) => profile.isCurrent) ?? runtime.profiles.find((profile) => profile.profile === runtime.currentProfile);
  const selected = runtime.profiles.find((profile) => profile.profile === selectedProfile);
  const user = runtime.user;
  const avatarUrl = resolveDwsAvatarUrl(user?.avatarUrl ?? null);
  const primaryLabel = user?.name ?? current?.userName ?? t('businessApplications.runtimeIdentity.userPending');
  const secondaryLabel = resolveDwsIdentitySecondaryLabel(primaryLabel, [
    user?.organization,
    current?.corpName,
    current?.profile,
  ]) ?? t('businessApplications.runtimeIdentity.profileMissing');
  const avatar = avatarUrl ? (
    <img className="h-9 w-9 rounded-md border border-aegis-border object-cover" src={avatarUrl} alt={t('businessApplications.runtimeIdentity.avatarAlt')} />
  ) : (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-dim" role="img" aria-label={t('businessApplications.runtimeIdentity.avatarMissing')} title={t('businessApplications.runtimeIdentity.avatarMissing')}><UserRound size={17} aria-hidden="true" /></span>
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
        {runtime.profiles.length > 0 && onSelectedProfileChange && onSwitchProfile && onLogoutProfile && (
          <div className="border-t border-aegis-border px-3 py-3">
            <label className="block text-[10px] text-aegis-text-secondary" htmlFor="dingtalk-runtime-profile">
              <span className="mb-1.5 block font-medium">{t('businessApplications.runtimeIdentity.accountProfile')}</span>
              <select
                id="dingtalk-runtime-profile"
                value={selectedProfile}
                onChange={(event) => onSelectedProfileChange(event.target.value)}
                disabled={operationActive}
                className="h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 font-mono text-[10px] text-aegis-text outline-none transition-colors focus:border-aegis-primary/50 focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runtime.profiles.map((profile) => (
                  <option key={profile.profile} value={profile.profile}>
                    {profile.corpName && profile.userName
                      ? `${profile.corpName} / ${profile.userName} (${profile.profile})`
                      : profile.profile}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1.5 text-[9.5px] leading-4 text-aegis-text-dim">
              {t('businessApplications.runtimeIdentity.profileActionsBoundary')}
            </p>
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              <Button
                size="xs"
                variant="outline"
                tone="neutral"
                disabled={!selected || selected.profile === runtime.currentProfile || operationActive}
                onClick={() => selected && onSwitchProfile(selected.profile)}
              >
                {t('businessApplications.runtimeIdentity.switchProfile')}
              </Button>
              <Button
                size="xs"
                variant="outline"
                tone="danger"
                disabled={!selected || operationActive}
                onClick={() => selected && onLogoutProfile(selected.profile)}
              >
                {t('businessApplications.runtimeIdentity.logoutProfile')}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg/55 px-2 py-1.5" title={current?.profile ?? undefined}>
      {avatarUrl ? (
        <img className="h-6 w-6 rounded-full border border-aegis-border object-cover" src={avatarUrl} alt={t('businessApplications.runtimeIdentity.avatarAlt')} />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-aegis-border bg-aegis-surface text-aegis-text-dim" role="img" aria-label={t('businessApplications.runtimeIdentity.avatarMissing')} title={t('businessApplications.runtimeIdentity.avatarMissing')}><UserRound size={12} aria-hidden="true" /></span>
      )}
      <div className="hidden min-w-0 leading-3.5 lg:block">
        <div className="truncate text-[10px] font-medium text-aegis-text-secondary">{primaryLabel}</div>
        <div className="truncate font-mono text-[9px] text-aegis-text-dim">{secondaryLabel}</div>
      </div>
      {current && <span className="ml-auto hidden shrink-0 items-center gap-1 text-[9px] text-aegis-success 2xl:flex" title={current.authorizedDomains.length ? t('businessApplications.runtimeIdentity.domainsTitle', { domains: current.authorizedDomains.join(', ') }) : t('businessApplications.runtimeIdentity.domainsNotReturned')}><ShieldCheck size={10} />{current.status ?? t('businessApplications.runtimeIdentity.read')}</span>}
    </div>
  );
}
