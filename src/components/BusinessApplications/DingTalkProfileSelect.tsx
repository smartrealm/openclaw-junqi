import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import type { DingTalkRuntimeProfileProjection } from '@/business-applications/dingtalkTools';

function profileDisplayName(profile: DingTalkRuntimeProfileProjection): string {
  if (profile.corpName && profile.userName) return `${profile.corpName} / ${profile.userName}`;
  return profile.userName ?? profile.corpName ?? profile.profile;
}

export function DingTalkProfileSelect({
  value,
  profiles,
  disabled = false,
  triggerId = 'dingtalk-profile',
  ariaLabel,
  onValueChange,
}: {
  value: string;
  profiles: readonly DingTalkRuntimeProfileProjection[];
  disabled?: boolean;
  triggerId?: string;
  ariaLabel?: string;
  onValueChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const accessibleLabel = ariaLabel ?? t('businessApplications.workbench.detail.profileLabel');
  return (
    <Select
      value={value || undefined}
      onValueChange={onValueChange}
      disabled={disabled || profiles.length === 0}
    >
      <SelectTrigger
        id={triggerId}
        aria-label={accessibleLabel}
        className="mt-1.5 h-8 w-full rounded-md border-aegis-border bg-aegis-input px-2.5 text-[11px] text-aegis-text shadow-none focus:ring-2 focus:ring-aegis-primary/25 focus:ring-offset-0"
      >
        <SelectValue placeholder={t('businessApplications.workbench.profile.noSignedInAccount')} />
      </SelectTrigger>
      <SelectContent
        align="start"
        sideOffset={4}
        className="max-w-[min(420px,calc(100vw-24px))] border-aegis-border bg-aegis-card-solid text-aegis-text shadow-[var(--aegis-menu-shadow)]"
      >
        {profiles.map((profile) => {
          const displayName = profileDisplayName(profile);
          const optionText = profile.isCurrent
            ? t('businessApplications.workbench.profile.currentOption', { profile: displayName })
            : displayName;
          return (
            <SelectItem
              key={profile.profile}
              value={profile.profile}
              textValue={optionText}
              className="min-h-8 rounded-md py-1.5 pl-8 pr-2 text-[11px] text-aegis-text-secondary focus:bg-aegis-primary/10 focus:text-aegis-text"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{displayName}</span>
                {profile.isCurrent && (
                  <span className="shrink-0 rounded border border-aegis-primary/20 bg-aegis-primary/10 px-1.5 py-0.5 text-[9px] text-aegis-primary">{t('businessApplications.workbench.profile.current')}</span>
                )}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
