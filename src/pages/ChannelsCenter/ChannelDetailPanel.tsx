import {
  Activity,
  AlertCircle,
  Check,
  Copy,
  Link2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  QrCode,
  ShieldCheck,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { AgentConfig } from '@/types/openclawConfig';
import type { ChannelAccountBinding, ChannelAccountReadiness } from '@/services/channelConfig';
import {
  channelAccountStatus,
  channelLinkMode,
  type ChannelsRuntimeSnapshot,
  type OfficialChannelCatalog,
  type OfficialChannelCatalogEntry,
  type OfficialChannelCapability,
} from '@/services/openclawChannelRuntime';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { ChannelRuntimeIcon } from '@/components/shared/ChannelRuntimeIcon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChannelGroupWithName } from './channelCenterTypes';

type AccountRuntimeMethod = 'channels.start' | 'channels.stop' | 'channels.logout';

interface ChannelDetailPanelProps {
  group?: ChannelGroupWithName;
  allGroupCount: number;
  catalog: OfficialChannelCatalog;
  runtimeSnapshot: ChannelsRuntimeSnapshot | null;
  capability?: OfficialChannelCapability | null;
  agents: AgentConfig[];
  saving: boolean;
  runtimeLoading: boolean;
  pluginInstalling: string;
  accountActionBusy: string;
  channelLogsBusy: string;
  channelLogPayload?: unknown;
  hasChannelLogPayload: boolean;
  getReadiness: (account: ChannelAccountBinding) => ChannelAccountReadiness;
  onInstallPlugin: (channelId: string) => void;
  onAddAccount: (group: ChannelGroupWithName) => void;
  onToggle: (channelId: string, enabled: boolean) => void;
  onProbe: (channelId: string) => void;
  onToggleLogs: (channelId: string) => void;
  onCopyRedacted: (group: ChannelGroupWithName) => void;
  onRemoveChannel: (group: ChannelGroupWithName) => void;
  onBind: (group: ChannelGroupWithName, account: ChannelAccountBinding, agentId: string) => void;
  onLink: (entry: OfficialChannelCatalogEntry | undefined, group: ChannelGroupWithName, account: ChannelAccountBinding) => void;
  onEditAccount: (group: ChannelGroupWithName, account: ChannelAccountBinding) => void;
  onRuntimeAction: (method: AccountRuntimeMethod, group: ChannelGroupWithName, account: ChannelAccountBinding) => void;
  onDeleteAccount: (group: ChannelGroupWithName, account: ChannelAccountBinding) => void;
}

function readinessClasses(readiness: ChannelAccountReadiness): string {
  if (readiness.state === 'ready') return 'border-aegis-success/20 bg-aegis-success/5 text-aegis-success';
  if (readiness.state === 'missing_credentials') return 'border-aegis-danger/20 bg-aegis-danger/5 text-aegis-danger';
  if (readiness.state === 'unbound' || readiness.state === 'unknown') return 'border-aegis-warning/20 bg-aegis-warning/5 text-aegis-warning';
  return 'border-aegis-border bg-aegis-surface text-aegis-text-dim';
}

export function ChannelDetailPanel({
  group,
  allGroupCount,
  catalog,
  runtimeSnapshot,
  capability,
  agents,
  saving,
  runtimeLoading,
  pluginInstalling,
  accountActionBusy,
  channelLogsBusy,
  channelLogPayload,
  hasChannelLogPayload,
  getReadiness,
  onInstallPlugin,
  onAddAccount,
  onToggle,
  onProbe,
  onToggleLogs,
  onCopyRedacted,
  onRemoveChannel,
  onBind,
  onLink,
  onEditAccount,
  onRuntimeAction,
  onDeleteAccount,
}: ChannelDetailPanelProps) {
  const { t } = useTranslation();

  if (!group) {
    return (
      <main className="flex min-h-[520px] flex-col items-center justify-center px-5 text-center">
        <MessageSquare size={28} className="text-aegis-text-muted" />
        <div className="mt-3 text-[12px] font-semibold text-aegis-text">
          {allGroupCount === 0
            ? t('channelsCenter.emptyTitle', 'No channels configured')
            : t('channelsCenter.noFilterResults', 'No matching accounts')}
        </div>
        <div className="mt-1 max-w-sm text-[10.5px] leading-5 text-aegis-text-muted">
          {allGroupCount === 0
            ? t('channelsCenter.emptyHint', 'Add a channel to let agents receive and respond from messaging apps.')
            : t('channelsCenter.noFilterResultsHint', 'Change the status filter to view other channel accounts.')}
        </div>
      </main>
    );
  }

  const catalogEntry = catalog.entries.find((entry) => entry.id === group.id);
  const pluginMissing = Boolean(
    catalogEntry?.managedInstall
    && catalog.source === 'openclaw-cli'
    && catalogEntry.installed === false
  );

  return (
    <main className="min-w-0">
      <div className="flex flex-col gap-3 border-b border-aegis-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-surface text-aegis-text-muted">
            <ChannelRuntimeIcon systemImage={runtimeSnapshot?.channelSystemImages?.[group.id]} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-[14px] font-semibold text-aegis-text">{group.name}</h2>
              {!group.known && (
                <span className="rounded-md border border-aegis-warning/25 px-1.5 py-0.5 text-[8.5px] font-semibold text-aegis-warning">
                  {t('config.unknownChannel', 'Unknown')}
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate font-mono text-[9.5px] text-aegis-text-muted">
              {group.id} · {group.accounts.length} {t('channelsCenter.accountUnit', 'account(s)')}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {pluginMissing && (
            <button
              type="button"
              onClick={() => onInstallPlugin(group.id)}
              disabled={saving || Boolean(pluginInstalling)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-2.5 text-[10.5px] font-semibold text-aegis-text-secondary hover:bg-aegis-hover disabled:opacity-50"
            >
              {pluginInstalling === group.id ? <LoadingIndicator size={12} /> : <Plus size={12} />}
              {t('channelsCenter.install', 'Install')}
            </button>
          )}
          {capability?.schema.accounts?.additionalProperties && (
            <button
              type="button"
              onClick={() => onAddAccount(group)}
              disabled={saving}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-2.5 text-[10.5px] font-semibold text-[rgb(var(--aegis-btn-primary-text))] disabled:opacity-50"
            >
              <Plus size={12} />
              {t('channelsCenter.addAccount', 'Add account')}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('channelsCenter.moreChannelActions', 'More channel actions')} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text">
                <MoreHorizontal size={13} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44 text-[11px]">
              <DropdownMenuItem onSelect={() => onToggle(group.id, !group.enabled)} disabled={saving} className="justify-start">
                <ShieldCheck size={12} />
                {group.enabled ? t('channelsCenter.disable', 'Disable') : t('channelsCenter.enable', 'Enable')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onProbe(group.id)} disabled={runtimeLoading} className="justify-start">
                <Activity size={12} />
                {t('channelsCenter.probe', 'Probe')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onToggleLogs(group.id)} className="justify-start">
                {channelLogsBusy === group.id ? <LoadingIndicator size={12} /> : <TerminalSquare size={12} />}
                {t('channelsCenter.channelLogs', 'Channel logs')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCopyRedacted(group)} className="justify-start">
                <Copy size={12} />
                {t('channelsCenter.copyRedacted', 'Copy redacted')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onRemoveChannel(group)} disabled={saving} className="justify-start text-aegis-danger focus:text-aegis-danger">
                <Trash2 size={12} />
                {t('common.remove', 'Remove')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {hasChannelLogPayload && (
          <details open className="rounded-md border border-aegis-border bg-aegis-surface">
            <summary className="cursor-pointer px-3 py-2 text-[10.5px] font-semibold text-aegis-text-secondary">
              {t('channelsCenter.channelLogs', 'Channel logs')}
            </summary>
            <pre className="max-h-56 overflow-auto border-t border-aegis-border p-3 text-[9.5px] leading-relaxed text-aegis-text-muted whitespace-pre-wrap break-all">
              {JSON.stringify(channelLogPayload, null, 2)}
            </pre>
          </details>
        )}

        <div className="divide-y divide-aegis-border overflow-hidden rounded-md border border-aegis-border bg-aegis-surface">
        {group.accounts.map((account) => {
          const runtime = channelAccountStatus(runtimeSnapshot, group.id, account.id);
          const readiness = getReadiness(account);
          const readinessLabel = t(`channelsCenter.readiness.${readiness.state}`, readiness.state);
          const readinessHint = readiness.state === 'missing_credentials'
            ? t('channelsCenter.missingFields', { fields: readiness.missingFields.join(', '), defaultValue: `Missing ${readiness.missingFields.join(', ')}` })
            : readiness.state === 'unknown'
              ? t('channelsCenter.runtimeStatusUnavailable', 'Runtime status unavailable; JunQi will not guess channel requirements.')
              : t(`channelsCenter.readinessHint.${readiness.state}`, '');
          const linkMode = channelLinkMode(capability, catalogEntry?.installed === true);
          const runtimeBusyPrefix = `${group.id}:${account.id}`;

          return (
            <section key={account.id}>
              <div className="grid grid-cols-1 gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <MessageSquare size={12} className="text-aegis-text-dim" />
                    <span className="truncate text-[12px] font-semibold text-aegis-text">{account.label}</span>
                    <span className="font-mono text-[9px] text-aegis-text-muted">{account.id}</span>
                    <span className={clsx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[8.5px] font-semibold', readinessClasses(readiness))}>
                      {readiness.state === 'ready' ? <Check size={9} /> : <AlertCircle size={9} />}
                      {readinessLabel}
                    </span>
                  </div>
                  {readinessHint && <div className="mt-1 text-[10px] text-aegis-text-dim">{readinessHint}</div>}
                </div>
                <label>
                  <span className="sr-only">{t('channelsCenter.boundAgent', 'Bound agent')}</span>
                  <select
                    value={account.agentId ?? ''}
                    onChange={(event) => onBind(group, account, event.target.value)}
                    disabled={saving}
                    className="h-8 w-full rounded-md border border-aegis-border bg-aegis-input px-2 text-[10.5px] text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
                  >
                    <option value="">{t('channelsCenter.defaultAgentRoute', 'Runtime default agent (no override)')}</option>
                    {agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name || agent.id}{agent.default ? ` · ${t('channelsCenter.defaultAgent', 'default')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-aegis-border bg-aegis-bg/35 px-3 py-2">
                {linkMode !== 'none' && (
                  <button type="button" onClick={() => onLink(catalogEntry, group, account)} disabled={Boolean(accountActionBusy)} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-primary/20 px-2 text-[10px] font-semibold text-aegis-primary hover:bg-aegis-primary/5 disabled:opacity-50">
                    {linkMode === 'embedded_qr' ? <QrCode size={11} /> : <Link2 size={11} />}
                    {linkMode === 'embedded_qr' ? t('channelsCenter.showQr', 'Show QR') : t('channelsCenter.linkAccount', 'Link account')}
                  </button>
                )}
                <button type="button" onClick={() => onEditAccount(group, account)} disabled={saving} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-aegis-border px-2 text-[10px] font-semibold text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text disabled:opacity-50">
                  <Pencil size={11} />
                  {t('channelsCenter.manageAccount', 'Manage account')}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" aria-label={t('channelsCenter.moreAccountActions', 'More account actions')} className="flex h-7 w-7 items-center justify-center rounded-md border border-aegis-border text-aegis-text-muted hover:bg-aegis-hover hover:text-aegis-text">
                      <MoreHorizontal size={11} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-40 text-[11px]">
                    <DropdownMenuItem onSelect={() => onRuntimeAction('channels.start', group, account)} disabled={Boolean(accountActionBusy)} className="justify-start">
                      {accountActionBusy === `channels.start:${runtimeBusyPrefix}` ? <LoadingIndicator size={11} /> : <Play size={11} />}
                      {t('channelsCenter.startAccount', 'Start account')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onRuntimeAction('channels.stop', group, account)} disabled={Boolean(accountActionBusy)} className="justify-start">
                      {accountActionBusy === `channels.stop:${runtimeBusyPrefix}` ? <LoadingIndicator size={11} /> : <Square size={11} />}
                      {t('channelsCenter.stopAccount', 'Stop account')}
                    </DropdownMenuItem>
                    {(runtime?.linked || linkMode !== 'none') && (
                      <DropdownMenuItem onSelect={() => onRuntimeAction('channels.logout', group, account)} disabled={Boolean(accountActionBusy)} className="justify-start text-aegis-warning focus:text-aegis-warning">
                        {accountActionBusy === `channels.logout:${runtimeBusyPrefix}` ? <LoadingIndicator size={11} /> : <LogOut size={11} />}
                        {t('channelsCenter.logoutAccount', 'Log out account')}
                      </DropdownMenuItem>
                    )}
                    {account.source === 'account' && (
                      <DropdownMenuItem onSelect={() => onDeleteAccount(group, account)} disabled={saving} className="justify-start text-aegis-danger focus:text-aegis-danger">
                        <Trash2 size={11} />
                        {t('common.remove', 'Remove')}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {runtime && (
                  <details className="ms-auto text-[9.5px] text-aegis-text-muted">
                    <summary className="cursor-pointer select-none">{t('channelsCenter.runtimeEvidence', 'Runtime evidence')}</summary>
                    <div className="mt-2 grid min-w-[220px] grid-cols-2 gap-x-3 gap-y-1 rounded-md border border-aegis-border bg-aegis-bg p-2">
                      <span>{t('channelsCenter.configuredState', 'Configured')}</span><span>{String(runtime.configured ?? false)}</span>
                      <span>{t('channelsCenter.linkedState', 'Linked')}</span><span>{String(runtime.linked ?? false)}</span>
                      <span>{t('channelsCenter.runningState', 'Running')}</span><span>{String(runtime.running ?? false)}</span>
                      <span>{t('channelsCenter.connectedState', 'Connected')}</span><span>{String(runtime.connected ?? false)}</span>
                      {runtime.lastError && <span className="col-span-2 break-words text-aegis-danger">{runtime.lastError}</span>}
                    </div>
                  </details>
                )}
              </div>
            </section>
          );
        })}
        </div>
      </div>
    </main>
  );
}
