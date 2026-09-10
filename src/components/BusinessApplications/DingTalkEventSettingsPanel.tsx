import { Plus, Radio, RefreshCw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DINGTALK_EVENT_CATEGORIES,
  DINGTALK_TODO_ROLES,
  eventKeysForCategory,
  type DingTalkEventCategory,
  type DingTalkEventConfiguration,
  type DingTalkEventKey,
  type DingTalkEventSubscription,
  type DingTalkTodoRole,
} from '@/business-applications/dingtalkEventConfiguration';
import type { DingTalkRuntimeProfileProjection } from '@/business-applications/dingtalkTools';
import { Button, IconButton } from '@/components/shared/button/Button';
import { Switch } from '@/components/shared/Switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DingTalkProfileSelect } from './DingTalkProfileSelect';
import { DingTalkEventInvalidationNotice } from './DingTalkEventInvalidationNotice';
import { DingTalkEventSnapshotStatus } from './DingTalkEventSnapshotStatus';
import {
  canSaveDingTalkEventConfiguration,
  createDingTalkEventSubscription,
  isDingTalkEventConfigurationValid,
} from './dingTalkEventSettingsState';

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

export function DingTalkEventSettingsPanel({
  configuration,
  profiles,
  loading,
  busy,
  editable,
  dirty,
  error,
  notice,
  latestInvalidation,
  eventSnapshot,
  eventSnapshotLoading,
  eventSnapshotError,
  onChange,
  onReload,
  onReloadEventSnapshot,
  onSave,
}: {
  configuration: DingTalkEventConfiguration | null;
  profiles: readonly DingTalkRuntimeProfileProjection[];
  loading: boolean;
  busy: boolean;
  editable: boolean;
  dirty: boolean;
  error: string | null;
  notice: string | null;
  latestInvalidation: {
    readonly revision: number;
    readonly eventType: string;
  } | null;
  eventSnapshot: {
    readonly phase: 'disabled' | 'starting' | 'running' | 'degraded' | 'stopping' | 'stopped';
    readonly activeConsumerCount: number;
    readonly readyConsumerCount: number;
    readonly latestSequence: number;
    readonly droppedCount: number;
    readonly rejectedCount: number;
    readonly lastErrorCode: string | null;
    readonly events: readonly {
      readonly sequence: number;
      readonly receivedAt: string;
      readonly eventType: string;
    }[];
  } | null;
  eventSnapshotLoading: boolean;
  eventSnapshotError: string | null;
  onChange: (configuration: DingTalkEventConfiguration) => void;
  onReload: () => void;
  onReloadEventSnapshot: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');

  if (!configuration) {
    return (
      <section className="m-4 rounded-lg border border-aegis-border bg-aegis-bg/70 p-4" aria-labelledby="dingtalk-event-settings-title">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-aegis-primary" aria-hidden="true" />
          <h2 id="dingtalk-event-settings-title" className="text-[13px] font-semibold text-aegis-text-secondary">{t('businessApplications.events.title')}</h2>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-aegis-text-dim">
          {loading ? t('businessApplications.events.loading') : error ?? t('businessApplications.events.unavailable')}
        </p>
        {!loading && (
          <Button className="mt-3" size="xs" variant="outline" tone="neutral" leadingIcon={<RefreshCw size={12} />} onClick={onReload}>
            {t('businessApplications.events.reload')}
          </Button>
        )}
      </section>
    );
  }

  const profileAvailable = !configuration.enabled || activeProfiles.some((candidate) => (
    candidate.profile === configuration.profile
  ));
  const configurationValid = isDingTalkEventConfigurationValid(configuration) && profileAvailable;
  const formDisabled = busy || loading || !editable;
  const changeSubscription = (index: number, next: DingTalkEventSubscription) => {
    onChange({ ...configuration, subscriptions: replaceAt(configuration.subscriptions, index, next) });
  };
  const toggleEnabled = (enabled: boolean) => {
    const currentProfile = activeProfiles.find((profile) => profile.isCurrent)?.profile
      ?? activeProfiles[0]?.profile
      ?? configuration.profile;
    onChange({
      ...configuration,
      enabled,
      profile: currentProfile,
      subscriptions: enabled && configuration.subscriptions.length === 0
        ? [createDingTalkEventSubscription('oa')]
        : configuration.subscriptions,
    });
  };
  const changeCategory = (index: number, category: DingTalkEventCategory) => {
    changeSubscription(index, createDingTalkEventSubscription(category));
  };
  const toggleEventKey = (index: number, key: DingTalkEventKey, checked: boolean) => {
    const subscription = configuration.subscriptions[index];
    if (!subscription) return;
    changeSubscription(index, {
      ...subscription,
      eventKeys: checked
        ? [...subscription.eventKeys, key]
        : subscription.eventKeys.filter((eventKey) => eventKey !== key),
    });
  };
  const toggleRole = (index: number, role: DingTalkTodoRole, checked: boolean) => {
    const subscription = configuration.subscriptions[index];
    if (!subscription) return;
    const roles = subscription.roleTypes ?? [];
    changeSubscription(index, {
      ...subscription,
      roleTypes: checked ? [...roles, role] : roles.filter((item) => item !== role),
    });
  };

  return (
    <section className="m-4 rounded-lg border border-aegis-border bg-aegis-bg/70" aria-labelledby="dingtalk-event-settings-title">
      <div className="flex items-start justify-between gap-3 border-b border-aegis-border px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-aegis-primary" aria-hidden="true" />
            <h2 id="dingtalk-event-settings-title" className="text-[13px] font-semibold text-aegis-text-secondary">{t('businessApplications.events.title')}</h2>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-aegis-text-dim">{t('businessApplications.events.description')}</p>
        </div>
        <IconButton aria-label={t('businessApplications.events.reload')} title={t('businessApplications.events.reload')} disabled={busy || loading} loading={loading} onClick={onReload}>
          <RefreshCw size={13} />
        </IconButton>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-aegis-border bg-aegis-surface/45 px-3.5 py-3">
          <div>
            <div className="text-[12px] font-medium text-aegis-text-secondary">{t('businessApplications.events.enabled')}</div>
            <div className="mt-0.5 text-[10.5px] text-aegis-text-dim">{t('businessApplications.events.enabledHint')}</div>
          </div>
          <Switch
            checked={configuration.enabled}
            disabled={formDisabled}
            size="sm"
            label={t('businessApplications.events.enabled')}
            onCheckedChange={toggleEnabled}
          />
        </div>

        {configuration.enabled && (
          <>
            <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_140px]">
              <label className="block text-[11px] text-aegis-text-secondary" htmlFor="dingtalk-event-profile">
                <span className="font-medium">{t('businessApplications.events.profile')}</span>
                <DingTalkProfileSelect
                  triggerId="dingtalk-event-profile"
                  ariaLabel={t('businessApplications.events.profile')}
                  value={configuration.profile}
                  profiles={activeProfiles}
                  disabled={formDisabled}
                  onValueChange={(profile) => onChange({ ...configuration, profile })}
                />
              </label>
              <label className="block text-[11px] text-aegis-text-secondary" htmlFor="dingtalk-event-buffer-size">
                <span className="font-medium">{t('businessApplications.events.bufferSize')}</span>
                <input
                  id="dingtalk-event-buffer-size"
                  type="number"
                  min={1}
                  max={200}
                  step={1}
                  value={configuration.bufferSize}
                  disabled={formDisabled}
                  onChange={(event) => onChange({ ...configuration, bufferSize: Number(event.target.value) })}
                  className="mt-1.5 h-8 w-full rounded-md border border-aegis-border bg-aegis-input px-2.5 text-[11px] text-aegis-text outline-none focus:border-aegis-primary/60 focus:ring-2 focus:ring-aegis-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
            </div>

            <div className="space-y-2">
              {configuration.subscriptions.map((subscription, index) => (
                <div key={`${index}:${subscription.category}`} className="rounded-md border border-aegis-border bg-aegis-surface/35 p-3">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <label className="block text-[11px] font-medium text-aegis-text-secondary" htmlFor={`dingtalk-event-category-${index}`}>{t('businessApplications.events.category')}</label>
                      <Select value={subscription.category} disabled={formDisabled} onValueChange={(value) => changeCategory(index, value as DingTalkEventCategory)}>
                        <SelectTrigger id={`dingtalk-event-category-${index}`} aria-label={t('businessApplications.events.category')} className="mt-1 h-8 w-full rounded-md border-aegis-border bg-aegis-bg px-2 text-[10px] text-aegis-text shadow-none focus:ring-2 focus:ring-aegis-primary/25 focus:ring-offset-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" sideOffset={4} className="border-aegis-border bg-aegis-card-solid text-aegis-text shadow-[var(--aegis-menu-shadow)]">
                          {DINGTALK_EVENT_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category} className="min-h-8 py-1.5 pl-8 pr-2 text-[10.5px] text-aegis-text-secondary focus:bg-aegis-primary/10 focus:text-aegis-text">
                              {t(`businessApplications.events.categories.${category}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <IconButton
                      aria-label={t('businessApplications.events.removeGroup', { index: index + 1 })}
                      title={t('businessApplications.events.removeGroup', { index: index + 1 })}
                      tone="danger"
                      disabled={formDisabled}
                      onClick={() => onChange({
                        ...configuration,
                        subscriptions: configuration.subscriptions.filter((_, itemIndex) => itemIndex !== index),
                      })}
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>

                  <fieldset className="mt-3">
                    <legend className="text-[11px] font-medium text-aegis-text-secondary">{t('businessApplications.events.eventTypes')}</legend>
                    <div className="mt-1.5 grid gap-1 sm:grid-cols-2 xl:grid-cols-3">
                      {eventKeysForCategory(subscription.category).map((key) => (
                        <label key={key} className="flex min-w-0 items-start gap-2 rounded-md border border-aegis-border/70 bg-aegis-bg/60 px-2.5 py-2 text-[10.5px] leading-4 text-aegis-text-dim">
                          <input
                            type="checkbox"
                            checked={subscription.eventKeys.includes(key)}
                            disabled={formDisabled}
                            onChange={(event) => toggleEventKey(index, key, event.target.checked)}
                            className="mt-0.5 shrink-0 accent-[rgb(var(--aegis-primary))]"
                          />
                          <span className="min-w-0 break-words">{t(`businessApplications.events.eventKeys.${key}`)}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {subscription.category === 'im-user' && (
                    <div className="mt-3 grid gap-2 md:grid-cols-[170px_minmax(220px,1fr)]">
                      <Select
                        value={subscription.openDingTalkId !== undefined ? 'openDingTalkId' : 'user'}
                        disabled={formDisabled}
                        onValueChange={(value) => changeSubscription(index, {
                          category: subscription.category,
                          eventKeys: subscription.eventKeys,
                          ...(value === 'openDingTalkId' ? { openDingTalkId: '' } : { user: '' }),
                        })}
                      >
                        <SelectTrigger aria-label={t('businessApplications.events.memberIdentityType')} className="h-8 w-full rounded-md border-aegis-border bg-aegis-bg px-2 text-[10px] text-aegis-text shadow-none focus:ring-2 focus:ring-aegis-primary/25 focus:ring-offset-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" sideOffset={4} className="border-aegis-border bg-aegis-card-solid text-aegis-text shadow-[var(--aegis-menu-shadow)]">
                          <SelectItem value="user">{t('businessApplications.events.userId')}</SelectItem>
                          <SelectItem value="openDingTalkId">{t('businessApplications.events.openDingTalkId')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <input
                        type="text"
                        value={subscription.openDingTalkId ?? subscription.user ?? ''}
                        disabled={formDisabled}
                        aria-label={t('businessApplications.events.memberIdentity')}
                        placeholder={t('businessApplications.events.memberIdentityPlaceholder')}
                        onChange={(event) => changeSubscription(index, {
                          category: subscription.category,
                          eventKeys: subscription.eventKeys,
                          ...(subscription.openDingTalkId !== undefined
                            ? { openDingTalkId: event.target.value }
                            : { user: event.target.value }),
                        })}
                        className="h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 text-[10px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
                      />
                    </div>
                  )}

                  {subscription.category === 'im-group' && (
                    <input
                      type="text"
                      value={subscription.group ?? ''}
                      disabled={formDisabled}
                      aria-label={t('businessApplications.events.groupId')}
                      placeholder={t('businessApplications.events.groupIdPlaceholder')}
                      onChange={(event) => changeSubscription(index, {
                        category: subscription.category,
                        eventKeys: subscription.eventKeys,
                        group: event.target.value,
                      })}
                      className="mt-3 h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 text-[10px] text-aegis-text outline-none placeholder:text-aegis-text-dim focus:border-aegis-primary/60 focus:ring-1 focus:ring-aegis-primary/25"
                    />
                  )}

                  {subscription.category === 'todo' && (
                    <fieldset className="mt-3">
                      <legend className="text-[11px] font-medium text-aegis-text-secondary">{t('businessApplications.events.todoRoles')}</legend>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {DINGTALK_TODO_ROLES.map((role) => (
                          <label key={role} className="flex items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg/60 px-2.5 py-2 text-[10.5px] text-aegis-text-dim">
                            <input type="checkbox" checked={subscription.roleTypes?.includes(role) ?? false} disabled={formDisabled} onChange={(event) => toggleRole(index, role, event.target.checked)} className="accent-[rgb(var(--aegis-primary))]" />
                            {t(`businessApplications.events.todoRole.${role}`)}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              ))}
            </div>

            <Button
              size="xs"
              variant="outline"
              tone="neutral"
              leadingIcon={<Plus size={12} />}
              disabled={formDisabled || configuration.subscriptions.length >= 8}
              onClick={() => onChange({
                ...configuration,
                subscriptions: [...configuration.subscriptions, createDingTalkEventSubscription('oa')],
              })}
            >
              {t('businessApplications.events.addGroup')}
            </Button>
          </>
        )}

        {!editable && <p className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.05] px-2.5 py-2 text-[10px] leading-4 text-aegis-warning" role="status">{t('businessApplications.events.mutationUnavailable')}</p>}
        {!configurationValid && <p className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.05] px-2.5 py-2 text-[10px] leading-4 text-aegis-warning" role="alert">{t(profileAvailable ? 'businessApplications.events.validationInvalid' : 'businessApplications.events.activeProfileRequired')}</p>}
        {error && <p className="rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.05] px-2.5 py-2 text-[10px] leading-4 text-aegis-danger" role="alert">{error}</p>}
        {notice && <p className="rounded-md border border-aegis-success/25 bg-aegis-success/[0.05] px-2.5 py-2 text-[10px] leading-4 text-aegis-success" role="status">{notice}</p>}
        <DingTalkEventInvalidationNotice invalidation={latestInvalidation} />
        {configuration.enabled && (
          <DingTalkEventSnapshotStatus
            snapshot={eventSnapshot}
            loading={eventSnapshotLoading}
            error={eventSnapshotError}
            onReload={onReloadEventSnapshot}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-aegis-border pt-3">
          <p className="max-w-3xl text-[10.5px] leading-4 text-aegis-text-dim">{t('businessApplications.events.writeBoundary')}</p>
          <div className="flex gap-2">
            <Button size="xs" variant="outline" tone="neutral" disabled={busy || loading} onClick={onReload}>{t('businessApplications.events.reload')}</Button>
            <Button size="xs" variant="solid" tone="primary" loading={busy} disabled={!editable || !profileAvailable || !canSaveDingTalkEventConfiguration(configuration, dirty)} onClick={onSave}>{t('businessApplications.events.saveAndRestart')}</Button>
          </div>
        </div>
      </div>
    </section>
  );
}
