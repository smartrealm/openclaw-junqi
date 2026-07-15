import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, MessageCircle, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { ChannelConfig, GatewayRuntimeConfig } from './types';
import { ConfirmDialog, ToggleSwitch } from './components';
import { getChannelTemplate } from './channelTemplates';
import { ChannelOfficialSchemaEditor } from './ChannelOfficialSchemaEditor';

interface ChannelsTabProps {
  config: GatewayRuntimeConfig;
  onChange: (updater: (prev: GatewayRuntimeConfig) => GatewayRuntimeConfig) => void;
}

function updateChannel(
  onChange: ChannelsTabProps['onChange'],
  channelId: string,
  value: Record<string, any>,
) {
  onChange((previous) => ({
    ...previous,
    channels: { ...previous.channels, [channelId]: value as ChannelConfig },
  }));
}

function ChannelConfigPanel({
  channelId,
  value,
  onChange,
  onRemove,
}: {
  channelId: string;
  value: ChannelConfig;
  onChange: ChannelsTabProps['onChange'];
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const template = getChannelTemplate(channelId);
  const accounts = value.accounts && typeof value.accounts === 'object' && !Array.isArray(value.accounts)
    ? value.accounts as Record<string, Record<string, any>>
    : {};

  const updateAccount = (accountId: string, account: Record<string, any>) => {
    updateChannel(onChange, channelId, {
      ...value,
      accounts: { ...accounts, [accountId]: account },
    });
  };

  return (
    <div className="overflow-hidden rounded-md border border-aegis-border bg-aegis-elevated">
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-white/[0.02]">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-aegis-border bg-aegis-surface text-[10px] font-bold text-aegis-text-muted">
          {template?.icon || channelId.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-aegis-text">{t(`config.channel.${channelId}`, channelId)}</div>
          <div className="truncate font-mono text-[10px] text-aegis-text-muted">{channelId}</div>
        </div>
        <span className={clsx('text-[10px] font-bold', value.enabled === false ? 'text-aegis-text-muted' : 'text-aegis-success')}>
          {value.enabled === false ? t('config.disabled', 'Disabled') : t('config.enabled', 'Enabled')}
        </span>
        <ChevronRight size={14} className={clsx('text-aegis-text-muted transition-transform', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="space-y-4 border-t border-aegis-border bg-aegis-bg/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-aegis-text-secondary">{t('config.enabled', 'Enabled')}</span>
            <ToggleSwitch value={value.enabled !== false} onChange={(enabled) => updateChannel(onChange, channelId, { ...value, enabled })} />
          </div>

          <ChannelOfficialSchemaEditor
            channelId={channelId}
            value={value}
            initiallyOpen
            onChange={(next) => updateChannel(onChange, channelId, next)}
          />

          {Object.entries(accounts).map(([accountId, account]) => (
            <div key={accountId} className="rounded-md border border-aegis-border bg-aegis-surface p-3">
              <div className="mb-2 font-mono text-[11px] font-semibold text-aegis-text-secondary">{accountId}</div>
              <ChannelOfficialSchemaEditor
                channelId={channelId}
                value={account}
                account
                onChange={(next) => updateAccount(accountId, next)}
              />
            </div>
          ))}

          <button type="button" onClick={() => setConfirmRemove(true)} className="inline-flex items-center gap-1.5 rounded-md border border-aegis-danger/25 px-3 py-2 text-xs font-semibold text-aegis-danger hover:bg-aegis-danger/10">
            <Trash2 size={13} />{t('config.removeChannel', 'Remove channel')}
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmRemove}
        title={t('config.removeChannel', 'Remove channel')}
        message={t('config.removeChannelConfirm', { channel: channelId })}
        confirmLabel={t('common.remove', 'Remove')}
        cancelLabel={t('common.cancel', 'Cancel')}
        onConfirm={() => { setConfirmRemove(false); onRemove(); }}
        onCancel={() => setConfirmRemove(false)}
        danger
      />
    </div>
  );
}

export function ChannelsTab({ config, onChange }: ChannelsTabProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const channels = Object.entries(config.channels ?? {}).filter(([channelId]) => channelId !== 'modelByChannel');

  const removeChannel = (channelId: string) => {
    onChange((previous) => {
      const nextChannels = { ...(previous.channels ?? {}) };
      delete nextChannels[channelId];
      const nextBindings = (previous.bindings ?? []).filter((binding) => binding.match?.channel !== channelId);
      return { ...previous, channels: nextChannels, bindings: nextBindings };
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-aegis-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-aegis-text"><MessageCircle size={15} />{t('config.channels', 'Channels')}</h2>
          <p className="mt-1 text-xs text-aegis-text-muted">{channels.length} {t('channelsCenter.enabledChannels', 'channels')}</p>
        </div>
        <button type="button" onClick={() => navigate('/channels')} className="inline-flex items-center justify-center gap-2 rounded-md bg-aegis-primary px-3 py-2 text-xs font-bold text-white">
          <Plus size={14} />{t('channelsCenter.addChannels', 'Add channel')}
        </button>
      </div>

      {channels.length === 0 ? (
        <button type="button" onClick={() => navigate('/channels')} className="w-full rounded-md border border-dashed border-aegis-border py-12 text-center text-sm text-aegis-text-muted hover:border-aegis-primary/35 hover:text-aegis-text">
          {t('channelsCenter.emptyTitle', 'No channels configured')}
        </button>
      ) : (
        <div className="space-y-2">
          {channels.map(([channelId, channel]) => (
            <ChannelConfigPanel
              key={channelId}
              channelId={channelId}
              value={channel}
              onChange={onChange}
              onRemove={() => removeChannel(channelId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
