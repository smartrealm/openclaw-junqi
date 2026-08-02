import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, Library, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import type { OpenClawConfig } from './types';
import { SchemaDrivenObjectEditor } from './SchemaDrivenObjectEditor';
import {
  configObjectFieldSchemas,
  loadOpenClawConfigSchema,
  type OpenClawFieldSchema,
} from '@/services/openclawConfigSchema';
import {
  ensureToolsEffectiveFresh,
  ensureToolsCatalogFresh,
  refreshToolsCatalog,
  refreshToolsEffective,
  useGatewayDataStore,
  type AgentInfo,
  type OpenClawToolsCatalogEntry,
  type OpenClawToolsCatalogGroup,
  type OpenClawToolsCatalogProfileId,
  type OpenClawToolsEffectiveGroup,
  type SessionInfo,
} from '@/stores/gatewayDataStore';

interface ToolsTabProps {
  config: OpenClawConfig;
  onChange: (updater: (prev: OpenClawConfig) => OpenClawConfig) => void;
}

function sessionLabel(session: SessionInfo): string {
  return typeof session.label === 'string' && session.label.trim()
    ? session.label.trim()
    : session.key;
}

function agentLabel(agent: AgentInfo): string {
  return typeof agent.name === 'string' && agent.name.trim()
    ? agent.name.trim()
    : agent.id;
}

function EffectiveToolsGroup({ group }: { group: OpenClawToolsEffectiveGroup }) {
  const { t } = useTranslation();
  const sourceLabel = t(`config.effectiveToolsSource.${group.source}`, group.source);
  return (
    <section className="border-t border-aegis-border/60 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-aegis-text">{group.label}</span>
          <span className="shrink-0 rounded border border-aegis-border bg-aegis-overlay px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-aegis-text-muted">
            {sourceLabel}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-aegis-text-muted">
          {t('config.effectiveToolsCount', '{{count}} tools', { count: group.tools.length })}
        </span>
      </div>
      {group.tools.length === 0 ? (
        <p className="text-xs text-aegis-text-muted">{t('config.effectiveToolsEmpty', 'No tools in this group.')}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {group.tools.map((tool) => (
            <div
              key={tool.id}
              className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-2.5 py-2"
              title={tool.description}
            >
              <Wrench size={13} className="shrink-0 text-aegis-text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-aegis-text">{tool.label}</div>
                <div className="truncate font-mono text-[10px] text-aegis-text-muted">{tool.id}</div>
              </div>
              {tool.deniedBySession ? (
                <span className="shrink-0 rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-300">
                  {t('config.effectiveToolsDenied', 'Denied')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CatalogToolRow({
  tool,
  profileLabels,
}: {
  tool: OpenClawToolsCatalogEntry;
  profileLabels: ReadonlyMap<OpenClawToolsCatalogProfileId, string>;
}) {
  const { t } = useTranslation();
  const riskLabel = tool.risk
    ? t(`config.effectiveToolsRisk.${tool.risk}`, tool.risk)
    : null;
  return (
    <div
      className="flex min-h-14 min-w-0 items-start gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-2.5 py-2"
      title={tool.description}
    >
      <Wrench size={13} className="mt-0.5 shrink-0 text-aegis-text-muted" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-aegis-text">{tool.label}</span>
          {tool.optional ? (
            <span className="shrink-0 rounded border border-aegis-border px-1.5 py-0.5 text-[10px] text-aegis-text-muted">
              {t('config.catalogToolOptional', 'Optional')}
            </span>
          ) : null}
          {riskLabel ? (
            <span className="shrink-0 rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-300">
              {riskLabel}
            </span>
          ) : null}
        </div>
        <div className="truncate font-mono text-[10px] text-aegis-text-muted">{tool.id}</div>
        {tool.defaultProfiles.length > 0 ? (
          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
            {tool.defaultProfiles.map((profile) => (
              <span key={profile} className="rounded border border-aegis-border px-1.5 py-0.5 text-[10px] text-aegis-text-muted">
                {profileLabels.get(profile) ?? profile}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {tool.tags?.length ? (
        <span className="max-w-28 shrink-0 truncate text-right text-[10px] text-aegis-text-muted" title={tool.tags.join(', ')}>
          {tool.tags.join(', ')}
        </span>
      ) : null}
    </div>
  );
}

function ToolsCatalogGroup({
  group,
  profileLabels,
}: {
  group: OpenClawToolsCatalogGroup;
  profileLabels: ReadonlyMap<OpenClawToolsCatalogProfileId, string>;
}) {
  const { t } = useTranslation();
  const sourceLabel = t(`config.effectiveToolsSource.${group.source}`, group.source);
  return (
    <section className="border-t border-aegis-border/60 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-aegis-text">{group.label}</span>
          <span className="shrink-0 rounded border border-aegis-border bg-aegis-overlay px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-aegis-text-muted">
            {sourceLabel}
          </span>
        </div>
        <span className="shrink-0 text-[11px] text-aegis-text-muted">
          {t('config.effectiveToolsCount', '{{count}} tools', { count: group.tools.length })}
        </span>
      </div>
      {group.tools.length === 0 ? (
        <p className="text-xs text-aegis-text-muted">{t('config.effectiveToolsEmpty', 'No tools in this group.')}</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {group.tools.map((tool) => (
            <CatalogToolRow key={`${group.id}:${tool.id}`} tool={tool} profileLabels={profileLabels} />
          ))}
        </div>
      )}
    </section>
  );
}

function ToolsCatalogPanel() {
  const { t } = useTranslation();
  const agents = useGatewayDataStore((state) => state.agents);
  const catalogs = useGatewayDataStore((state) => state.toolsCatalog);
  const loading = useGatewayDataStore((state) => state.toolsCatalogLoading);
  const loadingAgentId = useGatewayDataStore((state) => state.toolsCatalogLoadingAgentId);
  const error = useGatewayDataStore((state) => state.toolsCatalogError);
  const [selectedAgentId, setSelectedAgentId] = useState('');

  useEffect(() => {
    if (selectedAgentId && agents.some((agent) => agent.id === selectedAgentId)) return;
    setSelectedAgentId(agents[0]?.id ?? '');
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (selectedAgentId) void ensureToolsCatalogFresh(selectedAgentId);
  }, [selectedAgentId]);

  const selectedCatalog = selectedAgentId ? catalogs[selectedAgentId] : undefined;
  const refresh = useCallback(() => {
    if (selectedAgentId) void refreshToolsCatalog(selectedAgentId);
  }, [selectedAgentId]);
  const isLoadingSelected = loading && loadingAgentId === selectedAgentId;
  const profileLabels = new Map(
    selectedCatalog?.profiles.map((profile) => [profile.id, profile.label]) ?? [],
  );
  const errorLabel = error === 'OPENCLAW_TOOLS_CATALOG_UNSUPPORTED'
    ? t(
      'config.toolsCatalogUnavailable',
      'This OpenClaw Gateway does not advertise tools.catalog for the current connection.',
    )
    : t('config.toolsCatalogError', 'The Gateway did not return a valid tool catalog.');

  return (
    <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg border border-aegis-accent/30 bg-aegis-accent/10 p-1.5 text-aegis-accent">
            <Library size={15} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-aegis-text">
              {t('config.toolsCatalogTitle', 'Tool catalog')}
            </h3>
            <p className="mt-0.5 text-xs text-aegis-text-muted">
              {t(
                'config.toolsCatalogHint',
                'Read-only core and plugin catalog reported by OpenClaw for the selected agent.',
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!selectedAgentId || loading}
          title={t('config.toolsCatalogRefresh', 'Refresh tool catalog')}
          aria-label={t('config.toolsCatalogRefresh', 'Refresh tool catalog')}
          className="rounded-lg border border-aegis-border p-2 text-aegis-text-muted transition-colors hover:bg-aegis-overlay hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoadingSelected ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      {agents.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
          <Info size={14} aria-hidden="true" />
          {t('config.toolsCatalogNoAgents', 'No Gateway agents are available.')}
        </div>
      ) : (
        <>
          <label className="mb-3 block text-xs text-aegis-text-muted">
            <span className="mb-1.5 block">{t('config.toolsCatalogAgent', 'Agent')}</span>
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="w-full rounded-lg border border-aegis-border bg-aegis-overlay px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-accent sm:max-w-xl"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agentLabel(agent)}
                </option>
              ))}
            </select>
          </label>

          {error && !selectedCatalog ? (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-xs text-yellow-200">
              <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{errorLabel}</span>
            </div>
          ) : isLoadingSelected && !selectedCatalog ? (
            <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
              {t('config.toolsCatalogLoading', 'Loading the tool catalog…')}
            </div>
          ) : selectedCatalog ? (
            <div className="space-y-3">
              {selectedCatalog.profiles.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] text-aegis-text-muted">{t('config.toolsCatalogProfiles', 'Profiles')}</span>
                  {selectedCatalog.profiles.map((profile) => (
                    <span key={profile.id} className="rounded border border-aegis-border bg-aegis-overlay px-2 py-1 text-[11px] text-aegis-text-muted">
                      {profile.label}
                    </span>
                  ))}
                </div>
              ) : null}
              {selectedCatalog.groups.length === 0 ? (
                <p className="text-xs text-aegis-text-muted">{t('config.toolsCatalogEmpty', 'No catalog tools were reported.')}</p>
              ) : (
                <div className="space-y-3">
                  {selectedCatalog.groups.map((group) => (
                    <ToolsCatalogGroup key={group.id} group={group} profileLabels={profileLabels} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-aegis-text-muted">{t('config.toolsCatalogEmpty', 'No catalog tools were reported.')}</p>
          )}
        </>
      )}
    </div>
  );
}

function EffectiveToolsPanel() {
  const { t } = useTranslation();
  const sessions = useGatewayDataStore((state) => state.sessions);
  const effectiveTools = useGatewayDataStore((state) => state.toolsEffective);
  const loading = useGatewayDataStore((state) => state.toolsEffectiveLoading);
  const loadingSessionKey = useGatewayDataStore((state) => state.toolsEffectiveLoadingSessionKey);
  const error = useGatewayDataStore((state) => state.toolsEffectiveError);
  const [selectedSessionKey, setSelectedSessionKey] = useState('');

  useEffect(() => {
    if (selectedSessionKey && sessions.some((session) => session.key === selectedSessionKey)) return;
    setSelectedSessionKey(sessions[0]?.key ?? '');
  }, [selectedSessionKey, sessions]);

  useEffect(() => {
    if (selectedSessionKey) void ensureToolsEffectiveFresh(selectedSessionKey);
  }, [selectedSessionKey]);

  const selectedResult = selectedSessionKey ? effectiveTools[selectedSessionKey] : undefined;
  const refresh = useCallback(() => {
    if (selectedSessionKey) void refreshToolsEffective(selectedSessionKey);
  }, [selectedSessionKey]);
  const isLoadingSelected = loading && loadingSessionKey === selectedSessionKey;
  const errorLabel = error === 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED'
    ? t(
      'config.effectiveToolsUnavailable',
      'This OpenClaw Gateway does not advertise tools.effective for the current connection.',
    )
    : t('config.effectiveToolsError', 'The Gateway did not return a valid effective tool snapshot.');

  return (
    <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg border border-aegis-accent/30 bg-aegis-accent/10 p-1.5 text-aegis-accent">
            <ShieldCheck size={15} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-aegis-text">
              {t('config.effectiveToolsTitle', 'Effective tools')}
            </h3>
            <p className="mt-0.5 text-xs text-aegis-text-muted">
              {t(
                'config.effectiveToolsHint',
                'Read-only inventory reported by OpenClaw for the selected Session.',
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={!selectedSessionKey || loading}
          title={t('config.effectiveToolsRefresh', 'Refresh effective tools')}
          aria-label={t('config.effectiveToolsRefresh', 'Refresh effective tools')}
          className="rounded-lg border border-aegis-border p-2 text-aegis-text-muted transition-colors hover:bg-aegis-overlay hover:text-aegis-text disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoadingSelected ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
          <Info size={14} aria-hidden="true" />
          {t('config.effectiveToolsNoSessions', 'No Gateway Sessions are available.')}
        </div>
      ) : (
        <>
          <label className="mb-3 block text-xs text-aegis-text-muted">
            <span className="mb-1.5 block">{t('config.effectiveToolsSession', 'Session')}</span>
            <select
              value={selectedSessionKey}
              onChange={(event) => setSelectedSessionKey(event.target.value)}
              className="w-full rounded-lg border border-aegis-border bg-aegis-overlay px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-accent sm:max-w-xl"
            >
              {sessions.map((session) => (
                <option key={session.key} value={session.key}>
                  {sessionLabel(session)}
                </option>
              ))}
            </select>
          </label>

          {error && !selectedResult ? (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-xs text-yellow-200">
              {error === 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED'
                ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{errorLabel}</span>
            </div>
          ) : isLoadingSelected && !selectedResult ? (
            <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
              {t('config.effectiveToolsLoading', 'Loading the effective tool snapshot…')}
            </div>
          ) : selectedResult ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-aegis-text-muted">
                <span className="inline-flex items-center gap-1 rounded border border-aegis-border bg-aegis-overlay px-2 py-1">
                  <CheckCircle2 size={12} className="text-green-400" aria-hidden="true" />
                  {selectedResult.agentId}
                </span>
                <span className="rounded border border-aegis-border bg-aegis-overlay px-2 py-1">
                  {selectedResult.profile}
                </span>
              </div>
              {selectedResult.notices?.length ? (
                <div className="space-y-1.5">
                  {selectedResult.notices.map((notice) => (
                    <div
                      key={notice.id}
                      className="flex items-start gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-2 text-xs text-aegis-text-muted"
                    >
                      {notice.severity === 'warning'
                        ? <AlertTriangle size={13} className="mt-0.5 shrink-0 text-yellow-300" aria-hidden="true" />
                        : <Info size={13} className="mt-0.5 shrink-0 text-aegis-accent" aria-hidden="true" />}
                      <span>{notice.message}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {selectedResult.groups.length === 0 ? (
                <p className="text-xs text-aegis-text-muted">{t('config.effectiveToolsEmpty', 'No effective tools were reported.')}</p>
              ) : (
                <div className="space-y-3">
                  {selectedResult.groups.map((group) => <EffectiveToolsGroup key={group.id} group={group} />)}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-aegis-text-muted">{t('config.effectiveToolsEmpty', 'No effective tools were reported.')}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Tools and web-provider capabilities change with OpenClaw plugins. Render the
 * selected Runtime's schema instead of maintaining a JunQi provider/plugin map.
 */
export function ToolsTab({ config, onChange }: ToolsTabProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState<Record<string, OpenClawFieldSchema>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadOpenClawConfigSchema()
      .then((schema) => {
        if (cancelled) return;
        setFields(configObjectFieldSchemas(schema, 'tools'));
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <p className="text-sm text-aegis-text-muted">{t('common.loading', 'Loading…')}</p>;
  }

  if (error || Object.keys(fields).length === 0) {
    return (
      <>
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {t(
            'config.runtimeSchemaRequired',
            'The selected OpenClaw Runtime schema is unavailable. Tool settings are read-only; use the raw editor or official OpenClaw Wizard after the Runtime is available.',
          )}
          {error ? <p className="mt-1 text-xs opacity-80">{error}</p> : null}
        </div>
        <ToolsCatalogPanel />
        <EffectiveToolsPanel />
      </>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-aegis-border bg-aegis-elevated p-4">
        <p className="mb-3 text-xs text-aegis-text-muted">
          {t('config.runtimeSchemaAuthorityHint', 'Fields and accepted values come from the selected OpenClaw Runtime.')}
        </p>
        <SchemaDrivenObjectEditor
          title={t('config.tools', 'Tools')}
          fields={fields}
          value={config.tools ?? {}}
          initiallyOpen
          onChange={(tools) => onChange((prev) => ({ ...prev, tools }))}
        />
      </div>
      <ToolsCatalogPanel />
      <EffectiveToolsPanel />
    </>
  );
}

export default ToolsTab;
