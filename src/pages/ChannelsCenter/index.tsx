import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Bot, Check, ChevronDown, Copy, ExternalLink, ListFilter, Loader2, MessageSquare, Pencil, Plus, Power, RefreshCw, Save, Settings2, ShieldCheck, TerminalSquare, Trash2, Wifi, WifiOff, X } from 'lucide-react';
import clsx from 'clsx';
import { PageTransition } from '@/components/shared/PageTransition';
import { showAlert, showConfirm } from '@/components/shared/AlertDialog';
import { gatewayManager } from '@/services/gateway/GatewayConnectionManager';
import type { LogEntry } from '@/api/tauri-commands';
import type { AgentConfig, GatewayRuntimeConfig } from '@/pages/ConfigManager/types';
import { CHANNEL_TEMPLATES, getChannelTemplate, type ChannelTemplate } from '@/pages/ConfigManager/channelTemplates';
import {
  assessChannelAccountReadiness,
  addChannelAccount,
  addChannel,
  buildChannelGroups,
  persistChannelsOnly,
  removeChannelAccount,
  removeChannel,
  summarizeChannelReadiness,
  updateChannelBinding,
  updateChannelEnabled,
  upsertChannelAccount,
  type ChannelAccountReadiness,
  type ChannelAccountReadinessState,
  type ChannelGroupView,
  type ChannelAccountBinding,
} from '@/services/channelConfig';

function channelName(t: ReturnType<typeof useTranslation>['t'], id: string) {
  return t(`config.channel.${id}`, { defaultValue: getChannelTemplate(id)?.id ?? id });
}

function channelIcon(id: string) {
  const label = getChannelTemplate(id)?.icon || id.slice(0, 2).toUpperCase();
  return label;
}

type ChannelGroupWithName = ChannelGroupView & { name: string };
type ReadinessFilter = 'all' | ChannelAccountReadinessState;

interface EditingAccountState {
  mode: 'new' | 'edit';
  group: ChannelGroupWithName;
  account?: ChannelAccountBinding;
}

interface GatewayUiStatus {
  running: boolean;
  ready: boolean;
  error?: string | null;
}

function nextAccountId(channelId: string, groups: ChannelGroupWithName[]) {
  const used = new Set(groups.find((group) => group.id === channelId)?.accounts.map((account) => account.id) ?? []);
  let index = 1;
  let id = `${channelId}-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `${channelId}-${index}`;
  }
  return id;
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

function readinessTone(readiness: ChannelAccountReadiness, gatewayHealthy: boolean) {
  if (readiness.state === 'ready' && gatewayHealthy) return 'success';
  if (readiness.state === 'ready' && !gatewayHealthy) return 'warning';
  if (readiness.state === 'missing_credentials') return 'danger';
  if (readiness.state === 'unbound') return 'warning';
  return 'muted';
}

function readinessClasses(readiness: ChannelAccountReadiness, gatewayHealthy: boolean) {
  const tone = readinessTone(readiness, gatewayHealthy);
  if (tone === 'success') return 'bg-aegis-success/10 text-aegis-success border-aegis-success/20';
  if (tone === 'danger') return 'bg-aegis-danger/10 text-aegis-danger border-aegis-danger/20';
  if (tone === 'warning') return 'bg-aegis-warning/10 text-aegis-warning border-aegis-warning/20';
  return 'bg-[rgb(var(--aegis-overlay)/0.04)] text-aegis-text-dim border-[rgb(var(--aegis-overlay)/0.08)]';
}

function textValue(config: Record<string, unknown>, key: string, fallback = '') {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

function boolValue(config: Record<string, unknown>, key: string, fallback: boolean) {
  const value = config[key];
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(config: Record<string, unknown>, key: string, fallback: number) {
  const value = config[key];
  return typeof value === 'number' ? value : fallback;
}

interface ChannelAccountModalProps {
  state: EditingAccountState;
  agents: AgentConfig[];
  saving: boolean;
  t: ReturnType<typeof useTranslation>['t'];
  onClose: () => void;
  onSave: (accountId: string, accountConfig: Record<string, unknown>) => void;
  onDelete: (account: ChannelAccountBinding) => void;
}

function ChannelAccountModal({ state, agents, saving, t, onClose, onSave, onDelete }: ChannelAccountModalProps) {
  const tmpl = getChannelTemplate(state.group.id);
  const config = state.account?.config ?? {};
  const [accountId, setAccountId] = useState(state.account?.id ?? nextAccountId(state.group.id, [state.group]));
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...config,
    enabled: config.enabled !== false,
    name: textValue(config, 'name', state.account?.label === 'Default' ? '' : state.account?.label ?? ''),
    agentId: textValue(config, 'agentId'),
    mediaMaxMb: numberValue(config, 'mediaMaxMb', tmpl?.defaultMediaMaxMb ?? 10),
  }));

  const trimmedAccountId = accountId.trim();
  const accountIdValid = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(trimmedAccountId);
  const duplicateAccountId = state.mode === 'new' && state.group.accounts.some((account) => account.id === trimmedAccountId);
  const canSave = accountIdValid && !duplicateAccountId && !saving;

  const setField = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const credentialFields = getCredentialFields(tmpl);
  const connectionModes = getImConnectionModes(t, state.group.id);

  return (
    <div className="fixed inset-0 z-[2147482000] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-[620px] max-h-[88vh] overflow-hidden rounded-2xl border border-[rgb(var(--aegis-overlay)/0.12)] bg-aegis-bg shadow-2xl">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[rgb(var(--aegis-overlay)/0.08)]">
          <div className="min-w-0">
            <h3 className="text-[16px] font-extrabold text-aegis-text">
              {state.mode === 'new'
                ? t('channelsCenter.addAccount', 'Add account')
                : t('channelsCenter.editAccount', 'Edit account')}
            </h3>
            <p className="text-[11px] text-aegis-text-dim mt-0.5">
              {state.group.name} · {state.group.id}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)]">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[calc(88vh-132px)] px-5 py-4 space-y-5">
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('channelsCenter.accountId', 'Account ID')}>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={state.mode === 'edit'}
                aria-invalid={!accountIdValid || duplicateAccountId}
                className={clsx(
                  'w-full rounded-lg border bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text font-mono focus:outline-none disabled:opacity-60',
                  (!accountIdValid || duplicateAccountId)
                    ? 'border-aegis-danger/45 focus:border-aegis-danger/60'
                    : 'border-[rgb(var(--aegis-overlay)/0.1)] focus:border-aegis-primary/40'
                )}
              />
              {!accountIdValid && state.mode === 'new' && (
                <div className="mt-1 text-[10px] text-aegis-danger">
                  {t('channelsCenter.invalidAccountId', 'Use 2-64 letters, numbers, hyphen, or underscore.')}
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
                onChange={(e) => setField('name', e.target.value)}
                placeholder={t('channelsCenter.accountNamePlaceholder', 'Optional display name')}
                className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
              />
            </Field>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('channelsCenter.accountStatus', 'Status')}>
              <label className="flex items-center justify-between rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2">
                <span className="text-[12px] text-aegis-text">{t('config.enabled', 'Enabled')}</span>
                <input
                  type="checkbox"
                  checked={boolValue(values, 'enabled', true)}
                  onChange={(e) => setField('enabled', e.target.checked)}
                />
              </label>
            </Field>
            <Field label={t('channelsCenter.boundAgent', 'Bound agent')}>
              <select
                value={textValue(values, 'agentId')}
                onChange={(e) => setField('agentId', e.target.value)}
                className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
              >
                <option value="">{t('channelsCenter.noBinding', 'No bound agent')}</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                ))}
              </select>
            </Field>
          </section>

          {connectionModes.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <SectionTitle>{t('channelsCenter.integrationMode', 'Integration mode')}</SectionTitle>
                {tmpl?.docsUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(tmpl.docsUrl, '_blank', 'noopener,noreferrer')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] px-2 py-1 text-[10px] font-bold text-aegis-text-dim hover:border-aegis-primary/25 hover:text-aegis-primary"
                  >
                    <ExternalLink size={11} />
                    {t('channelsCenter.openDocs', 'Open docs')}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {connectionModes.map((mode) => (
                  <div
                    key={mode.label}
                    className={clsx(
                      'rounded-lg border px-3 py-2',
                      mode.enabled
                        ? 'border-aegis-primary/20 bg-aegis-primary/10'
                        : 'border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)] opacity-75'
                    )}
                  >
                    <div className={clsx(
                      'text-[11px] font-extrabold',
                      mode.enabled ? 'text-aegis-primary' : 'text-aegis-text-muted'
                    )}>
                      {mode.label}
                    </div>
                    <div className="mt-1 text-[10px] leading-relaxed text-aegis-text-dim">
                      {mode.description}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {credentialFields.length > 0 && (
            <section className="space-y-3">
              <SectionTitle>{t('channelsCenter.credentials', 'Credentials')}</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {credentialFields.map((field) => (
                  <Field key={field.key} label={field.label}>
                    <input
                      type={field.secret ? 'password' : 'text'}
                      value={textValue(values, field.key)}
                      onChange={(e) => setField(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text font-mono focus:outline-none focus:border-aegis-primary/40"
                    />
                  </Field>
                ))}
              </div>
            </section>
          )}

          {tmpl && (
            <section className="space-y-3">
              <SectionTitle>{t('channelsCenter.routingPolicy', 'Routing policy')}</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {tmpl.supportsDmPolicy && (
                  <Field label={t('config.dmPolicy', 'DM policy')}>
                    <select
                      value={textValue(values, 'dmPolicy', tmpl.defaultDmPolicy ?? '')}
                      onChange={(e) => setField('dmPolicy', e.target.value)}
                      className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                    >
                      {(tmpl.dmPolicyOptions ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                )}
                {tmpl.supportsGroupPolicy && (
                  <Field label={t('config.groupPolicy', 'Group policy')}>
                    <select
                      value={textValue(values, 'groupPolicy', tmpl.defaultGroupPolicy ?? '')}
                      onChange={(e) => setField('groupPolicy', e.target.value)}
                      className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                    >
                      {(tmpl.groupPolicyOptions ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                )}
                {tmpl.defaultMediaMaxMb !== undefined && (
                  <Field label={t('config.mediaMaxMb', 'Media max MB')}>
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={String(numberValue(values, 'mediaMaxMb', tmpl.defaultMediaMaxMb))}
                      onChange={(e) => setField('mediaMaxMb', Number(e.target.value))}
                      className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                    />
                  </Field>
                )}
              </div>
            </section>
          )}

          {tmpl?.extraFields && tmpl.extraFields.length > 0 && (
            <section className="space-y-3">
              <SectionTitle>{t('channelsCenter.options', 'Options')}</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {tmpl.extraFields.map((field) => (
                  <Field key={field.key} label={t(field.labelKey, field.key)}>
                    {field.type === 'boolean' ? (
                      <label className="flex items-center justify-between rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)] px-3 py-2">
                        <span className="text-[12px] text-aegis-text">{t('config.enabled', 'Enabled')}</span>
                        <input
                          type="checkbox"
                          checked={boolValue(values, field.key, Boolean(field.defaultValue))}
                          onChange={(e) => setField(field.key, e.target.checked)}
                        />
                      </label>
                    ) : (
                      <input
                        type={field.type === 'number' ? 'number' : 'text'}
                        value={String(values[field.key] ?? field.defaultValue ?? '')}
                        onChange={(e) => setField(field.key, field.type === 'number' ? Number(e.target.value) : e.target.value)}
                        className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-[rgb(var(--aegis-overlay)/0.04)] px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                      />
                    )}
                  </Field>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-[rgb(var(--aegis-overlay)/0.08)]">
          {state.mode === 'edit' && state.account?.source === 'account' && (
            <button
              onClick={() => onDelete(state.account!)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 text-aegis-danger text-[12px] font-bold disabled:opacity-50"
            >
              <Trash2 size={13} />
              {t('common.remove', 'Remove')}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} disabled={saving} className="px-4 py-2 rounded-lg text-[12px] font-semibold text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.06)] disabled:opacity-50">
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={() => onSave(trimmedAccountId, cleanAccountConfig(values))}
            disabled={!canSave}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-aegis-primary text-[rgb(var(--aegis-btn-primary-text))] text-[12px] font-extrabold disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {t('settings.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function getCredentialFields(tmpl?: ChannelTemplate) {
  if (!tmpl) return [];
  const fields: Array<{ key: string; label: string; placeholder?: string; secret?: boolean }> = [];
  if (tmpl.id === 'feishu') {
    fields.push(
      { key: 'appId', label: 'App ID' },
      { key: 'appSecret', label: 'App Secret', secret: true },
    );
  }
  if (tmpl.id === 'dingtalk') {
    fields.push(
      { key: 'appKey', label: 'App Key' },
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'robotCode', label: 'Robot Code' },
    );
  }
  if (tmpl.tokenField) {
    fields.push({
      key: tmpl.tokenField,
      label: tmpl.tokenField,
      placeholder: tmpl.tokenEnvKey ? `env:${tmpl.tokenEnvKey}` : undefined,
      secret: /token|secret|key/i.test(tmpl.tokenField),
    });
  }
  return fields;
}

function getImConnectionModes(t: ReturnType<typeof useTranslation>['t'], channelId: string) {
  if (channelId === 'feishu') {
    return [
      {
        label: t('channelsCenter.modeHttpsCallback', 'HTTPS callback'),
        description: t('channelsCenter.feishuHttpsHint', 'Use Feishu event subscription callback with app credentials.'),
        enabled: true,
      },
      {
        label: t('channelsCenter.modeQrAuth', 'QR authorization'),
        description: t('channelsCenter.qrAuthGatewayRequired', 'Requires a real Gateway login-session API before it can be enabled.'),
        enabled: false,
      },
    ];
  }
  if (channelId === 'dingtalk') {
    return [
      {
        label: t('channelsCenter.modeStream', 'Stream'),
        description: t('channelsCenter.dingtalkStreamHint', 'Use DingTalk Stream mode with appKey, appSecret, and robotCode.'),
        enabled: true,
      },
      {
        label: t('channelsCenter.modeHttpsCallback', 'HTTPS callback'),
        description: t('channelsCenter.dingtalkHttpsHint', 'Use a public HTTPS callback URL when Stream is disabled.'),
        enabled: true,
      },
      {
        label: t('channelsCenter.modeQrAuth', 'QR authorization'),
        description: t('channelsCenter.qrAuthGatewayRequired', 'Requires a real Gateway login-session API before it can be enabled.'),
        enabled: false,
      },
    ];
  }
  return [];
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="text-[10px] uppercase tracking-widest font-extrabold text-aegis-text-muted">{children}</div>;
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold text-aegis-text-dim mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function ChannelsCenterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusedAgentId = searchParams.get('agent')?.trim() || '';
  const [configPath, setConfigPath] = useState('');
  const [config, setConfig] = useState<GatewayRuntimeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<EditingAccountState | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayUiStatus | null>(null);
  const [gatewayLogs, setGatewayLogs] = useState<LogEntry[]>([]);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gatewayActionBusy, setGatewayActionBusy] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [readinessFilter, setReadinessFilter] = useState<ReadinessFilter>('all');
  const savingRef = useRef(false);
  const gatewayRefreshTimersRef = useRef<number[]>([]);

  const loadGatewaySnapshot = useCallback(async () => {
    setGatewayLoading(true);
    try {
      if (!window.aegis?.gateway) {
        throw new Error('Gateway API unavailable');
      }
      const [status, logs] = await Promise.all([
        window.aegis.gateway.getStatus(),
        window.aegis.gateway.getLogs?.(120) ?? Promise.resolve([]),
      ]);
      setGatewayStatus(status as GatewayUiStatus);
      setGatewayLogs(logs as LogEntry[]);
    } catch (err) {
      setGatewayStatus({ running: false, ready: false, error: err instanceof Error ? err.message : String(err) });
      setGatewayLogs([]);
    } finally {
      setGatewayLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const detected = await window.aegis.config.detect();
      setConfigPath(detected.path);
      if (!detected.exists) {
        setConfig(null);
        setError(t('channelsCenter.configMissing', 'OpenClaw config file was not found.'));
        return;
      }
      const { data } = await window.aegis.config.read(detected.path);
      setConfig(data as GatewayRuntimeConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const clearGatewayRefreshTimers = useCallback(() => {
    gatewayRefreshTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    gatewayRefreshTimersRef.current = [];
  }, []);

  const scheduleGatewayRefresh = useCallback(() => {
    clearGatewayRefreshTimers();
    [900, 2200, 4200, 7000].forEach((delay) => {
      const timerId = window.setTimeout(() => {
        void loadGatewaySnapshot();
        void load();
      }, delay);
      gatewayRefreshTimersRef.current.push(timerId);
    });
  }, [clearGatewayRefreshTimers, loadGatewaySnapshot, load]);

  useEffect(() => {
    void load();
    void loadGatewaySnapshot();
    return () => clearGatewayRefreshTimers();
  }, [clearGatewayRefreshTimers, load, loadGatewaySnapshot]);

  const groups = useMemo(() =>
    buildChannelGroups(config).map((group) => ({ ...group, name: channelName(t, group.id) })),
    [config, t]
  );
  const agents = useMemo(() => (config?.agents?.list ?? []) as AgentConfig[], [config]);
  const accountCount = groups.reduce((sum, group) => sum + group.accounts.length, 0);
  const readinessSummary = useMemo(() => summarizeChannelReadiness(groups), [groups]);
  const focusedAgent = useMemo(() => (
    focusedAgentId ? agents.find((agent) => agent.id === focusedAgentId) : undefined
  ), [agents, focusedAgentId]);

  const filteredGroups = useMemo(() => {
    return groups
      .map((group) => ({
        ...group,
        accounts: group.accounts.filter((account) => {
          const matchesAgent = !focusedAgentId || account.agentId === focusedAgentId || !account.agentId;
          const matchesReadiness = readinessFilter === 'all'
            || assessChannelAccountReadiness(group.id, account).state === readinessFilter;
          return matchesAgent && matchesReadiness;
        }),
      }))
      .filter((group) => group.accounts.length > 0);
  }, [groups, focusedAgentId, readinessFilter]);

  useEffect(() => {
    if (!focusedAgentId || filteredGroups.length === 0) return;
    setExpanded((current) => current ?? filteredGroups[0].id);
  }, [focusedAgentId, filteredGroups]);

  const filteredAccountCount = filteredGroups.reduce((sum, group) => sum + group.accounts.length, 0);
  const addableTemplates = CHANNEL_TEMPLATES.filter(tmpl => !groups.some(group => group.id === tmpl.id));
  const gatewayHealthy = Boolean(gatewayStatus?.running && gatewayStatus?.ready);
  const gatewayStateLabel = gatewayLoading
    ? t('channelsCenter.gatewayChecking', 'Checking Gateway')
    : gatewayHealthy
      ? t('channelsCenter.gatewayHealthy', 'Gateway running')
      : t('channelsCenter.gatewayOffline', 'Gateway offline');
  const latestGatewayLog = gatewayLogs[gatewayLogs.length - 1];

  const saveConfig = async (next: GatewayRuntimeConfig, successMessage: string) => {
    if (savingRef.current) return;
    if (!configPath) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const merged = await persistChannelsOnly(configPath, next);
      setConfig(merged);
      const restart = await window.aegis.config.restart().catch((err: unknown) => ({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
      if (!restart?.success) {
        showAlert(t('channelsCenter.savedWithRestartWarning', 'Saved, but Gateway restart failed'), String(restart?.error ?? ''), 'warning');
      } else {
        showAlert(t('common.saved', 'Saved'), successMessage, 'success');
      }
      scheduleGatewayRefresh();
      window.dispatchEvent(new CustomEvent('aegis:config-saved', { detail: { channelsChanged: true } }));
    } catch (err) {
      showAlert(t('config.saveFailed', 'Save failed'), err instanceof Error ? err.message : String(err), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleToggle = (channelId: string, enabled: boolean) => {
    if (!config) return;
    void saveConfig(updateChannelEnabled(config, channelId, enabled), t('channelsCenter.channelUpdated', 'Channel updated.'));
  };

  const handleBind = (group: ChannelGroupView & { name: string }, account: ChannelAccountBinding, agentId: string) => {
    if (!config) return;
    void saveConfig(updateChannelBinding(config, group.id, account, agentId), t('channelsCenter.bindingUpdated', 'Binding updated.'));
  };

  const handleGatewayRestart = async () => {
    if (gatewayActionBusy) return;
    setGatewayActionBusy(true);
    try {
      const result = await gatewayManager.restart();
      if (!result?.success) {
        throw new Error(result?.error || 'Gateway restart failed');
      }
      showAlert(t('common.saved', 'Saved'), t('channelsCenter.gatewayRestarted', 'Gateway restart triggered.'), 'success');
      scheduleGatewayRefresh();
    } catch (err) {
      showAlert(t('channelsCenter.gatewayRestartFailed', 'Gateway restart failed'), err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setGatewayActionBusy(false);
      void loadGatewaySnapshot();
    }
  };

  const handleCopyDiagnostics = async () => {
    const payload = {
      status: gatewayStatus,
      logs: gatewayLogs,
      channels: groups.map((group) => ({
        id: group.id,
        enabled: group.enabled,
        known: group.known,
        accounts: group.accounts.map((account) => ({
          id: account.id,
          enabled: account.enabled,
          source: account.source,
          agentId: account.agentId ?? null,
          readiness: assessChannelAccountReadiness(group.id, account),
        })),
      })),
    };
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
    showAlert(t('common.copied', 'Copied'), t('channelsCenter.diagnosticsCopied', 'Diagnostics copied.'), 'success');
  };

  const handleClearGatewayLogs = async () => {
    const ok = await window.aegis?.gateway?.clearLogs?.();
    if (ok) setGatewayLogs([]);
  };

  const handleSaveAccount = async (accountId: string, accountConfig: Record<string, unknown>) => {
    if (!config || !editingAccount) return;
    if (editingAccount.mode === 'new' && editingAccount.group.accounts.some((account) => account.id === accountId)) {
      showAlert(
        t('channelsCenter.duplicateAccountTitle', 'Duplicate account ID'),
        t('channelsCenter.duplicateAccountId', 'This account ID already exists in the selected channel.'),
        'error'
      );
      return;
    }
    const next = editingAccount.mode === 'new'
      ? addChannelAccount(config, editingAccount.group.id, accountId, accountConfig)
      : upsertChannelAccount(
        config,
        editingAccount.group.id,
        editingAccount.account ?? { id: accountId, source: 'account' },
        accountConfig,
      );
    await saveConfig(next, t('channelsCenter.accountSaved', 'Account saved.'));
    setExpanded(editingAccount.group.id);
    setEditingAccount(null);
  };

  const handleDeleteAccount = (group: ChannelGroupWithName, account: ChannelAccountBinding) => {
    if (!config || account.source !== 'account') return;
    showConfirm(
      t('channelsCenter.removeAccountTitle', 'Remove account'),
      t('channelsCenter.removeAccountMessage', { account: account.label, defaultValue: `Remove ${account.label}?` }),
      () => {
        void saveConfig(removeChannelAccount(config, group.id, account.id), t('channelsCenter.accountRemoved', 'Account removed.'));
        setEditingAccount(null);
      }
    );
  };

  const handleRemove = (group: ChannelGroupView & { name: string }) => {
    if (!config) return;
    showConfirm(
      t('channelsCenter.removeTitle', 'Remove channel'),
      t('channelsCenter.removeMessage', { channel: group.name, defaultValue: `Remove ${group.name}?` }),
      () => { void saveConfig(removeChannel(config, group.id), t('channelsCenter.channelRemoved', 'Channel removed.')); }
    );
  };

  const handleAdd = (channelId: string) => {
    if (!config) return;
    const next = addChannel(config, channelId);
    setExpanded(channelId);
    void saveConfig(next, t('channelsCenter.channelAdded', 'Channel added.'));
  };

  return (
    <PageTransition className="p-5 space-y-5 max-w-[1100px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold text-aegis-text">
            {t('sidebar.nav.channels', 'Channels')}
          </h1>
          <p className="text-[12px] text-aegis-text-dim mt-0.5">
            {t('channelsCenter.subtitle', 'Connect agents to Feishu, DingTalk, Telegram, Discord and other message channels.')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void load()} disabled={loading || saving} title={t('common.refresh', 'Refresh')} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.05)] disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : undefined} />
          </button>
          <button onClick={() => setDiagnosticsOpen((open) => !open)} className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text text-[11px] font-semibold">
            <TerminalSquare size={14} />
            {t('channelsCenter.diagnostics', 'Diagnostics')}
          </button>
          <button onClick={() => navigate('/config?tab=channels')} className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-aegis-text-muted hover:text-aegis-text font-semibold text-[11px]">
            <Settings2 size={15} />
            {t('channelsCenter.advancedConfig', 'Advanced config')}
          </button>
          <button onClick={() => document.getElementById('available-channels')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 px-3 h-8 rounded-md bg-aegis-primary text-white font-semibold text-[11px] hover:opacity-90">
            <Plus size={14} />
            {t('channelsCenter.addChannels', 'Add channel')}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-aegis-danger/20 bg-aegis-danger/10 px-4 py-3 text-[12px] text-aegis-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24 text-aegis-text-dim">
          <Loader2 size={24} className="animate-spin" />
        </div>
      ) : (
        <>
          {(!gatewayHealthy || diagnosticsOpen) && <section className={clsx(
            'rounded-md border px-4 py-3',
            gatewayHealthy
              ? 'border-aegis-success/20 bg-aegis-success/5'
              : 'border-aegis-warning/25 bg-aegis-warning/10'
          )}>
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className={clsx(
                  'w-9 h-9 rounded-md flex items-center justify-center shrink-0',
                  gatewayHealthy ? 'bg-aegis-success/12 text-aegis-success' : 'bg-aegis-warning/12 text-aegis-warning'
                )}>
                  {gatewayLoading
                    ? <Loader2 size={18} className="animate-spin" />
                    : gatewayHealthy
                      ? <Wifi size={18} />
                      : <WifiOff size={18} />}
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-extrabold text-aegis-text">{gatewayStateLabel}</div>
                  <div className="mt-0.5 text-[11px] text-aegis-text-dim truncate">
                    {gatewayStatus?.error
                      ? gatewayStatus.error
                      : latestGatewayLog
                        ? latestGatewayLog.message
                        : t('channelsCenter.gatewayHint', 'Channel changes require Gateway restart before runtime adapters reconnect.')}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void loadGatewaySnapshot()}
                  disabled={gatewayLoading || gatewayActionBusy}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text disabled:opacity-50"
                >
                  <RefreshCw size={13} className={gatewayLoading ? 'animate-spin' : undefined} />
                  {t('common.refresh', 'Refresh')}
                </button>
                <button
                  onClick={() => void handleGatewayRestart()}
                  disabled={gatewayActionBusy}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-aegis-primary/25 bg-aegis-primary/10 text-[11px] font-semibold text-aegis-primary disabled:opacity-50"
                >
                  {gatewayActionBusy ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                  {t('channelsCenter.restartGateway', 'Restart Gateway')}
                </button>
                <button
                  onClick={() => void handleCopyDiagnostics()}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text"
                >
                  <Copy size={13} />
                  {t('channelsCenter.copyDiagnostics', 'Copy diagnostics')}
                </button>
                <button
                  onClick={() => setDiagnosticsOpen((open) => !open)}
                  className="inline-flex items-center gap-2 px-3 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.1)] text-[11px] font-semibold text-aegis-text-muted hover:text-aegis-text"
                >
                  <TerminalSquare size={13} />
                  {diagnosticsOpen ? t('channelsCenter.hideLogs', 'Hide logs') : t('channelsCenter.showLogs', 'Show logs')}
                </button>
              </div>
            </div>

            {diagnosticsOpen && (
              <div className="mt-3 rounded-lg border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.035)] overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[rgb(var(--aegis-overlay)/0.08)]">
                  <span className="text-[10px] uppercase tracking-widest font-extrabold text-aegis-text-muted">
                    {t('channelsCenter.gatewayLogs', 'Gateway logs')}
                  </span>
                  <button
                    onClick={() => void handleClearGatewayLogs()}
                    className="text-[10px] font-bold text-aegis-text-dim hover:text-aegis-text"
                  >
                    {t('settings.gatewayLog.clear', 'Clear')}
                  </button>
                </div>
                {gatewayLogs.length === 0 ? (
                  <div className="px-3 py-5 text-center text-[11px] text-aegis-text-dim">
                    {t('settings.gatewayLog.empty', 'No log entries yet. Start the Gateway to see stdout/stderr here.')}
                  </div>
                ) : (
                  <pre className="max-h-[240px] overflow-auto px-3 py-2 text-[10px] leading-relaxed text-aegis-text-dim whitespace-pre-wrap break-all">
                    {gatewayLogs.map((entry) => {
                      const time = new Date(entry.timestamp_ms).toLocaleTimeString();
                      return `[${time}] ${entry.level.toUpperCase()} ${entry.source}: ${entry.message}`;
                    }).join('\n')}
                  </pre>
                )}
              </div>
            )}
          </section>}

          <section className="space-y-3">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                <h2 className="text-[13px] font-semibold text-aegis-text-secondary">
                  {t('channelsCenter.configured', 'Configured channels')}
                </h2>
                <div className="mt-0.5 text-[10px] text-aegis-text-dim">
                  {groups.length} {t('channelsCenter.enabledChannels', 'channels')} · {readinessSummary.ready} / {accountCount} {t('channelsCenter.readyAccounts', 'ready')}
                </div>
                </div>
                {saving && <span className="inline-flex items-center gap-1.5 text-[11px] text-aegis-primary"><Loader2 size={12} className="animate-spin" />{t('agentSettings.saving', 'Saving...')}</span>}
              </div>

              {groups.length > 0 && (
                <div className="flex flex-col gap-2 border-y border-[rgb(var(--aegis-overlay)/0.08)] py-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-aegis-text-dim">
                      <ListFilter size={13} />
                      {t('channelsCenter.filterByStatus', 'Filter by status')}
                      <span className="font-mono text-[10px] text-aegis-text-muted">
                        {filteredAccountCount} / {accountCount}
                      </span>
                    </div>
                    {focusedAgentId && (
                      <div className="flex items-center gap-2 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 px-2.5 py-1.5">
                        <Bot size={12} className="text-aegis-primary" />
                        <span className="text-[11px] font-bold text-aegis-primary truncate max-w-[220px]">
                          {t('channelsCenter.focusedAgent', 'Focused agent')}: {focusedAgent?.name || focusedAgentId}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = new URLSearchParams(searchParams);
                            next.delete('agent');
                            setSearchParams(next, { replace: true });
                          }}
                          className="rounded p-0.5 text-aegis-primary/70 hover:bg-aegis-primary/15 hover:text-aegis-primary"
                          title={t('channelsCenter.clearAgentFocus', 'Clear agent focus')}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([
                      ['all', t('channelsCenter.filterAll', 'All'), accountCount],
                      ['ready', t('channelsCenter.readiness.ready', 'Ready'), readinessSummary.ready],
                      ['missing_credentials', t('channelsCenter.readiness.missing_credentials', 'Missing credentials'), readinessSummary.missing_credentials],
                      ['unbound', t('channelsCenter.readiness.unbound', 'Unbound'), readinessSummary.unbound],
                      ['disabled', t('channelsCenter.readiness.disabled', 'Disabled'), readinessSummary.disabled],
                    ] as const).map(([key, label, count]) => (
                      <button
                        key={key}
                        onClick={() => setReadinessFilter(key)}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                          readinessFilter === key
                            ? 'bg-aegis-primary/10 text-aegis-primary'
                            : 'text-aegis-text-dim hover:text-aegis-text hover:bg-[rgb(var(--aegis-overlay)/0.04)]'
                        )}
                      >
                        <span>{label}</span>
                        <span className="rounded bg-[rgb(var(--aegis-overlay)/0.08)] px-1.5 py-0.5 text-[9px]">
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[rgb(var(--aegis-overlay)/0.12)] py-14 text-center">
                <MessageSquare size={32} className="mx-auto text-aegis-text-dim opacity-50" />
                <div className="mt-3 text-[14px] font-semibold text-aegis-text">{t('channelsCenter.emptyTitle', 'No channels configured')}</div>
                <div className="mt-1 text-[12px] text-aegis-text-dim">{t('channelsCenter.emptyHint', 'Add a channel below to let agents receive and respond from messaging apps.')}</div>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[rgb(var(--aegis-overlay)/0.12)] py-10 text-center">
                <ListFilter size={28} className="mx-auto text-aegis-text-dim opacity-50" />
                <div className="mt-3 text-[14px] font-semibold text-aegis-text">{t('channelsCenter.noFilterResults', 'No matching accounts')}</div>
                <div className="mt-1 text-[12px] text-aegis-text-dim">{t('channelsCenter.noFilterResultsHint', 'Change the status filter to view other channel accounts.')}</div>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map((group) => {
                  const open = expanded === group.id;
                  const originalAccountCount = groups.find((item) => item.id === group.id)?.accounts.length ?? group.accounts.length;
                  return (
                    <div key={group.id} className="rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] overflow-hidden">
                      <button onClick={() => setExpanded(open ? null : group.id)} className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[rgb(var(--aegis-overlay)/0.03)]">
                        <div className="w-8 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] flex items-center justify-center text-[10px] font-bold text-aegis-text-muted">
                          {channelIcon(group.id)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[14px] font-bold text-aegis-text">{group.name}</span>
                            {!group.known && <span className="rounded px-1.5 py-0.5 text-[9px] font-bold bg-yellow-500/10 text-yellow-400">{t('config.unknownChannel', 'Unknown')}</span>}
                          </div>
                          <div className="text-[11px] text-aegis-text-dim font-mono">
                            {group.id} · {group.accounts.length}{readinessFilter !== 'all' ? ` / ${originalAccountCount}` : ''} {t('channelsCenter.accountUnit', 'account(s)')}
                          </div>
                        </div>
                        <span className={clsx('inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold', group.enabled ? 'text-aegis-success' : 'text-aegis-text-dim')}>
                          {group.enabled ? <Check size={11} /> : <AlertCircle size={11} />}
                          {group.enabled ? t('config.enabled', 'Enabled') : t('config.disabled', 'Disabled')}
                        </span>
                        <ChevronDown size={15} className={clsx('text-aegis-text-dim transition-transform', open && 'rotate-180')} />
                      </button>

                      {open && (
                        <div className="border-t border-[rgb(var(--aegis-overlay)/0.08)] px-4 py-4 space-y-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <button onClick={() => handleToggle(group.id, !group.enabled)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              <ShieldCheck size={13} />
                              {group.enabled ? t('channelsCenter.disable', 'Disable') : t('channelsCenter.enable', 'Enable')}
                            </button>
                            {getChannelTemplate(group.id)?.supportsMultiAccount && (
                              <button
                                onClick={() => setEditingAccount({ mode: 'new', group })}
                                disabled={saving}
                                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-aegis-primary/25 bg-aegis-primary/10 text-[12px] font-semibold text-aegis-primary disabled:opacity-50"
                              >
                                <Plus size={13} />
                                {t('channelsCenter.addAccount', 'Add account')}
                              </button>
                            )}
                            <button onClick={() => navigate('/config?tab=channels')} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              <Settings2 size={13} />
                              {t('channelsCenter.advancedConfig', 'Advanced config')}
                            </button>
                            <button onClick={() => navigator.clipboard.writeText(JSON.stringify(group.config, null, 2)).catch(() => undefined)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] text-[12px] font-semibold text-aegis-text-muted hover:text-aegis-text">
                              <Copy size={13} />
                              {t('common.copy', 'Copy')}
                            </button>
                            <button onClick={() => handleRemove(group)} disabled={saving} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-aegis-danger/25 bg-aegis-danger/10 text-[12px] font-semibold text-aegis-danger">
                              <Trash2 size={13} />
                              {t('common.remove', 'Remove')}
                            </button>
                          </div>

                          <div className="space-y-2">
                            {group.accounts.map((account) => {
                              const readiness = assessChannelAccountReadiness(group.id, account);
                              const readinessLabel = readiness.state === 'ready' && !gatewayHealthy
                                ? t('channelsCenter.waitingGateway', 'Waiting for Gateway')
                                : t(`channelsCenter.readiness.${readiness.state}`, readiness.state);
                              const readinessHint = readiness.state === 'missing_credentials'
                                ? t('channelsCenter.missingFields', { fields: readiness.missingFields.join(', '), defaultValue: `Missing ${readiness.missingFields.join(', ')}` })
                                : readiness.state === 'ready' && !gatewayHealthy
                                  ? t('channelsCenter.gatewayOfflineHint', 'Gateway is offline. Restart or refresh Gateway to activate this account.')
                                  : t(`channelsCenter.readinessHint.${readiness.state}`, '');

                              return (
                                <div key={account.id} className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-center rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-aegis-bg px-3 py-2.5">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <MessageSquare size={13} className="text-aegis-text-dim" />
                                      <span className="text-[13px] font-semibold text-aegis-text truncate">{account.label}</span>
                                      <span className="text-[10px] font-mono text-aegis-text-dim">{account.id}</span>
                                      <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-extrabold', readinessClasses(readiness, gatewayHealthy))}>
                                        {readiness.state === 'ready' && gatewayHealthy ? <Check size={10} /> : <AlertCircle size={10} />}
                                        {readinessLabel}
                                      </span>
                                    </div>
                                    {readinessHint && (
                                      <div className="mt-1 text-[11px] text-aegis-text-dim">
                                        {readinessHint}
                                      </div>
                                    )}
                                  </div>
                                  <select
                                    value={account.agentId ?? ''}
                                    onChange={(e) => handleBind(group, account, e.target.value)}
                                    disabled={saving}
                                    className="w-full rounded-lg border border-[rgb(var(--aegis-overlay)/0.1)] bg-aegis-bg px-3 py-2 text-[12px] text-aegis-text focus:outline-none focus:border-aegis-primary/40"
                                  >
                                    <option value="">{t('channelsCenter.noBinding', 'No bound agent')}</option>
                                    {agents.map((agent) => (
                                      <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                                    ))}
                                  </select>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      onClick={() => setEditingAccount({ mode: 'edit', group, account })}
                                      disabled={saving}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-aegis-primary/20 bg-aegis-primary/10 text-aegis-primary text-[11px] font-bold disabled:opacity-50"
                                    >
                                      <Pencil size={12} />
                                      {t('common.edit', 'Edit')}
                                    </button>
                                    {account.source === 'account' && (
                                      <button
                                        onClick={() => handleDeleteAccount(group, account)}
                                        disabled={saving}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-aegis-danger/20 bg-aegis-danger/10 text-aegis-danger text-[11px] font-bold disabled:opacity-50"
                                      >
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section id="available-channels" className="space-y-3 scroll-mt-4">
            <h2 className="text-[13px] font-semibold text-aegis-text-secondary">
              {t('channelsCenter.addChannels', 'Add channels')}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {addableTemplates.map((tmpl) => (
                <button key={tmpl.id} onClick={() => handleAdd(tmpl.id)} disabled={!config || saving} className="flex items-center gap-3 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)] px-3 py-2.5 text-left hover:border-aegis-primary/30 hover:bg-aegis-primary/[0.04] disabled:opacity-50">
                  <div className="w-8 h-8 rounded-md border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)] flex items-center justify-center text-[10px] font-bold text-aegis-text-muted">
                    {channelIcon(tmpl.id)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-aegis-text">{channelName(t, tmpl.id)}</div>
                    <div className="text-[10px] text-aegis-text-dim truncate">{tmpl.supportsMultiAccount ? t('channelsCenter.multiAccount', 'Multi-account') : t('channelsCenter.singleAccount', 'Single account')}</div>
                  </div>
                  <Plus size={14} className="text-aegis-primary" />
                </button>
              ))}
            </div>
          </section>

        </>
      )}
      {editingAccount && (
        <ChannelAccountModal
          key={`${editingAccount.mode}:${editingAccount.group.id}:${editingAccount.account?.id ?? 'new'}`}
          state={editingAccount}
          agents={agents}
          saving={saving}
          t={t}
          onClose={() => setEditingAccount(null)}
          onSave={(accountId, accountConfig) => { void handleSaveAccount(accountId, accountConfig); }}
          onDelete={(account) => handleDeleteAccount(editingAccount.group, account)}
        />
      )}
    </PageTransition>
  );
}

export default ChannelsCenterPage;
