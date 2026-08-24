import { UserPlus, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';
import {
  resolveDwsAvatarUrl,
  resolveDwsIdentitySecondaryLabel,
  resolveDwsProfileActionState,
} from '@/business-applications/dwsProfileSelection';
import { Button } from '@/components/shared/button/Button';
import { DingTalkProfileSelect } from './DingTalkProfileSelect';

export function DingTalkRuntimeIdentity({
  runtime,
  mode = 'compact',
  selectedProfile = '',
  operationActive = false,
  profileOperationsAvailable = true,
  onSelectedProfileChange,
  onAddProfile,
  onSwitchProfile,
  onLogoutProfile,
}: {
  runtime: DingTalkRuntimeIdentityProjection | null;
  mode?: 'compact' | 'full';
  selectedProfile?: string;
  operationActive?: boolean;
  profileOperationsAvailable?: boolean;
  onSelectedProfileChange?: (profile: string) => void;
  onAddProfile?: () => void;
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
  const profileActionState = resolveDwsProfileActionState(
    runtime.profiles,
    runtime.currentProfile,
    selectedProfile,
  );
  const selected = profileActionState.selected;
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
        </dl>
        {runtime.profiles.length > 0 && onSelectedProfileChange && onAddProfile && onSwitchProfile && onLogoutProfile && (
          <div className="border-t border-aegis-border px-3 py-3">
            <div className="block text-[10px] text-aegis-text-secondary">
              <span className="mb-1.5 block font-medium">{t('businessApplications.runtimeIdentity.accountProfile')}</span>
              <DingTalkProfileSelect
                triggerId="dingtalk-runtime-profile"
                ariaLabel={t('businessApplications.runtimeIdentity.accountProfile')}
                value={selectedProfile}
                profiles={runtime.profiles}
                onValueChange={onSelectedProfileChange}
                disabled={operationActive || !profileOperationsAvailable}
              />
            </div>
            <p className="mt-1.5 text-[9.5px] leading-4 text-aegis-text-dim">
              {profileActionState.onlyOneProfile
                ? t('businessApplications.runtimeIdentity.singleProfileHint')
                : t('businessApplications.runtimeIdentity.profileActionsBoundary')}
            </p>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <Button
                size="xs"
                variant="outline"
                tone="primary"
                disabled={operationActive}
                leadingIcon={<UserPlus size={12} aria-hidden="true" />}
                onClick={onAddProfile}
              >
                {t('businessApplications.runtimeIdentity.addProfile')}
              </Button>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  tone="neutral"
                  disabled={!profileActionState.canSwitch || operationActive || !profileOperationsAvailable}
                  title={!profileOperationsAvailable
                    ? t('businessApplications.runtimeIdentity.profileOperationsUnavailable')
                    : selected?.profile === runtime.currentProfile
                      ? t('businessApplications.runtimeIdentity.alreadyCurrent')
                      : undefined}
                  onClick={() => selected && onSwitchProfile(selected.profile)}
                >
                  {t('businessApplications.runtimeIdentity.switchProfile')}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  tone="danger"
                  disabled={!selected || operationActive || !profileOperationsAvailable}
                  title={!profileOperationsAvailable ? t('businessApplications.runtimeIdentity.profileOperationsUnavailable') : undefined}
                  onClick={() => selected && onLogoutProfile(selected.profile)}
                >
                  {t('businessApplications.runtimeIdentity.logoutProfile')}
                </Button>
              </div>
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
      {current && <span className="ml-auto hidden shrink-0 text-[9px] text-aegis-text-dim 2xl:block" title={t('businessApplications.runtimeIdentity.identityStatus')}>{current.status ?? t('businessApplications.runtimeIdentity.read')}</span>}
    </div>
  );
}
