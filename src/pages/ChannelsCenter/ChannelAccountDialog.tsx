import { useId, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import type { AgentConfig } from '@/types/openclawConfig';
import type { ChannelAccountBinding } from '@/services/channelConfig';
import { channelAccountEditorValues } from '@/services/channelConfig';
import { isOpenClawChannelIdentifier } from '@/services/openclawChannelRuntime';
import { ChannelOfficialSchemaEditor } from '@/pages/ConfigManager/ChannelOfficialSchemaEditor';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { nextChannelAccountId, type EditingAccountState } from './channelCenterTypes';

interface ChannelAccountDialogProps {
  state: EditingAccountState;
  agents: AgentConfig[];
  saving: boolean;
  onClose: () => void;
  onSave: (accountId: string, accountConfig: Record<string, unknown>) => void;
  onDelete: (account: ChannelAccountBinding) => void;
}

function textValue(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

function boolValue(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function cleanAccountConfig(values: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) next[key] = trimmed;
      continue;
    }
    if (value !== undefined && value !== null) next[key] = value;
  }
  return next;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const labelId = useId();
  return (
    <div className="block" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="mb-1.5 block text-[10px] font-bold text-aegis-text-dim">{label}</span>
      {children}
    </div>
  );
}

export function ChannelAccountDialog({
  state,
  agents,
  saving,
  onClose,
  onSave,
  onDelete,
}: ChannelAccountDialogProps) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState(
    state.account?.id ?? nextChannelAccountId(state.group.id, [state.group]),
  );
  const [values, setValues] = useState<Record<string, unknown>>(() => (
    channelAccountEditorValues(state.account)
  ));

  const trimmedAccountId = accountId.trim();
  const accountIdValid = isOpenClawChannelIdentifier(trimmedAccountId);
  const duplicateAccountId = state.mode === 'new'
    && state.group.accounts.some((account) => account.id === trimmedAccountId);
  const canSave = accountIdValid && !duplicateAccountId && !saving;

  const setField = (key: string, value: unknown) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[min(720px,92dvh)] w-[min(620px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text shadow-float sm:rounded-lg">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="text-[15px] font-semibold text-aegis-text">
            {state.mode === 'new'
              ? t('channelsCenter.addAccount', 'Add account')
              : t('channelsCenter.editAccount', 'Edit account')}
          </DialogTitle>
          <DialogDescription className="mt-1 font-mono text-[10.5px] text-aegis-text-dim">
            {state.group.name} · {state.group.id}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92dvh-132px)] space-y-5 overflow-y-auto px-5 py-4">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('channelsCenter.accountId', 'Account ID')}>
              <input
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                disabled={state.mode === 'edit'}
                aria-invalid={!accountIdValid || duplicateAccountId}
                className={clsx(
                  'w-full rounded-md border bg-aegis-surface px-3 py-2 text-[12px] font-mono text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:opacity-60',
                  (!accountIdValid || duplicateAccountId) ? 'border-aegis-danger/45' : 'border-aegis-border',
                )}
              />
              {!accountIdValid && state.mode === 'new' && (
                <div className="mt-1 text-[10px] text-aegis-danger">
                  {t('channelsCenter.invalidAccountId', 'Use 1-128 letters, numbers, period, underscore, hyphen, or colon; begin with a letter or number.')}
                </div>
              )}
              {accountIdValid && duplicateAccountId && (
                <div className="mt-1 text-[10px] text-aegis-danger">
                  {t('channelsCenter.duplicateAccountId', 'This account ID already exists in the selected channel.')}
                </div>
              )}
            </Field>
            <Field label={t('channelsCenter.accountName', 'Display name')}>
              <input
                value={textValue(values, 'name')}
                onChange={(event) => setField('name', event.target.value)}
                placeholder={t('channelsCenter.accountNamePlaceholder', 'Optional display name')}
                className="w-full rounded-md border border-aegis-border bg-aegis-surface px-3 py-2 text-[12px] text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
              />
            </Field>
          </section>

          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('channelsCenter.accountStatus', 'Status')}>
              <label className="flex items-center justify-between rounded-md border border-aegis-border bg-aegis-surface px-3 py-2">
                <span className="text-[12px] text-aegis-text">{t('config.enabled', 'Enabled')}</span>
                <input
                  type="checkbox"
                  checked={boolValue(values, 'enabled', true)}
                  onChange={(event) => setField('enabled', event.target.checked)}
                />
              </label>
            </Field>
            <Field label={t('channelsCenter.boundAgent', 'Bound agent')}>
              <select
                value={textValue(values, 'agentId')}
                onChange={(event) => setField('agentId', event.target.value)}
                className="w-full rounded-md border border-aegis-border bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/35"
              >
                <option value="">{t('channelsCenter.defaultAgentRoute', 'Runtime default agent (no override)')}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name || agent.id}{agent.default ? ` · ${t('channelsCenter.defaultAgent', 'default')}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          </section>

          <ChannelOfficialSchemaEditor
            channelId={state.group.id}
            value={values}
            account={state.account?.source === 'account' || state.mode === 'new'}
            initiallyOpen
            disabled={saving}
            onChange={setValues}
          />
        </div>

        <DialogFooter className="flex-row items-center border-t border-aegis-border bg-aegis-surface px-5 py-3">
          {state.mode === 'edit' && state.account?.source === 'account' && (
            <button
              type="button"
              onClick={() => onDelete(state.account!)}
              disabled={saving}
              className="me-auto inline-flex items-center gap-2 rounded-md border border-aegis-danger/25 px-3 py-2 text-[11px] font-semibold text-aegis-danger disabled:opacity-50"
            >
              <Trash2 size={13} />
              {t('common.remove', 'Remove')}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-aegis-border px-3 py-2 text-[11px] font-semibold text-aegis-text-dim hover:bg-aegis-hover disabled:opacity-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(trimmedAccountId, cleanAccountConfig(values))}
            disabled={!canSave}
            className="inline-flex items-center gap-2 rounded-md bg-aegis-primary px-3 py-2 text-[11px] font-semibold text-[rgb(var(--aegis-btn-primary-text))] disabled:opacity-50"
          >
            {saving ? <LoadingIndicator size={13} /> : <Save size={13} />}
            {t('settings.save', 'Save')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
