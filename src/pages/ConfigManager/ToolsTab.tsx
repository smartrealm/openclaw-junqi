import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, Library, Play, RefreshCw, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
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
  invokeOpenClawTool,
  OpenClawToolsInvokeUnavailableError,
  useGatewayDataStore,
  type AgentInfo,
  type OpenClawToolsCatalogEntry,
  type OpenClawToolsCatalogGroup,
  type OpenClawToolsCatalogProfileId,
  type OpenClawToolsEffectiveGroup,
  type OpenClawToolsInvokeResult,
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
      'This OpenClaw Gateway does not support tools.catalog for the current connection.',
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

function formatToolValue(value: unknown, emptyLabel: string): string {
  if (value === undefined) return emptyLabel;
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized === undefined ? emptyLabel : serialized;
  } catch {
    return emptyLabel;
  }
}

function ToolInvokePanel() {
  const { t } = useTranslation();
  const sessions = useGatewayDataStore((state) => state.sessions);
  const effectiveTools = useGatewayDataStore((state) => state.toolsEffective);
  const loading = useGatewayDataStore((state) => state.toolsEffectiveLoading);
  const loadingSessionKey = useGatewayDataStore((state) => state.toolsEffectiveLoadingSessionKey);
  const effectiveError = useGatewayDataStore((state) => state.toolsEffectiveError);
  const [selectedSessionKey, setSelectedSessionKey] = useState('');
  const [selectedToolName, setSelectedToolName] = useState('');
  const [argsText, setArgsText] = useState('{}');
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<OpenClawToolsInvokeResult | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [invoking, setInvoking] = useState(false);

  useEffect(() => {
    if (selectedSessionKey && sessions.some((session) => session.key === selectedSessionKey)) return;
    setSelectedSessionKey(sessions[0]?.key ?? '');
  }, [selectedSessionKey, sessions]);

  useEffect(() => {
    if (selectedSessionKey) void ensureToolsEffectiveFresh(selectedSessionKey);
  }, [selectedSessionKey]);

  const selectedResult = selectedSessionKey ? effectiveTools[selectedSessionKey] : undefined;
  const tools = selectedResult?.groups.flatMap((group) => group.tools)
    .filter((tool) => tool.deniedBySession !== true) ?? [];
  const selectedTool = tools.find((tool) => tool.id === selectedToolName);

  useEffect(() => {
    if (selectedToolName && tools.some((tool) => tool.id === selectedToolName)) return;
    setSelectedToolName(tools[0]?.id ?? '');
  }, [selectedToolName, tools]);

  const isLoadingSelected = loading && loadingSessionKey === selectedSessionKey;
  const submit = useCallback(async () => {
    if (!selectedSessionKey || !selectedToolName || invoking) return;
    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(argsText);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(t('config.toolsInvokeArgsObject', 'Tool arguments must be a JSON object.'));
      }
      args = parsed as Record<string, unknown>;
    } catch (error) {
      setResult(null);
      setLocalError(error instanceof Error ? error.message : String(error));
      return;
    }

    setInvoking(true);
    setResult(null);
    setLocalError(null);
    try {
      const response = await invokeOpenClawTool({
        name: selectedToolName,
        args,
        sessionKey: selectedSessionKey,
        confirm,
      });
      setResult(response);
    } catch (error) {
      const message = error instanceof OpenClawToolsInvokeUnavailableError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
      setLocalError(message);
    } finally {
      setInvoking(false);
    }
  }, [argsText, confirm, invoking, selectedSessionKey, selectedToolName, t]);

  return (
    <div className="mt-4 rounded-xl border border-aegis-border bg-aegis-elevated p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-1.5 text-yellow-300">
            <ShieldAlert size={15} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-aegis-text">
              {t('config.toolsInvokeTitle', 'Invoke an OpenClaw tool')}
            </h3>
            <p className="mt-0.5 text-xs text-aegis-text-muted">
              {t(
                'config.toolsInvokeHint',
                'Runs the selected effective tool through the Gateway. OpenClaw owns validation, policy and approval.',
              )}
            </p>
          </div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
          <Info size={14} aria-hidden="true" />
          {t('config.toolsInvokeNoSessions', 'No Gateway Sessions are available.')}
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs text-aegis-text-muted">
            <span className="mb-1.5 block">{t('config.toolsInvokeSession', 'Session')}</span>
            <select
              value={selectedSessionKey}
              onChange={(event) => {
                setSelectedSessionKey(event.target.value);
                setResult(null);
                setLocalError(null);
              }}
              className="w-full rounded-lg border border-aegis-border bg-aegis-overlay px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-accent"
            >
              {sessions.map((session) => (
                <option key={session.key} value={session.key}>
                  {sessionLabel(session)}
                </option>
              ))}
            </select>
          </label>

          {effectiveError && !selectedResult ? (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-3 text-xs text-yellow-200">
              {effectiveError === 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED'
                ? <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                : <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />}
              <span>{effectiveError === 'OPENCLAW_TOOLS_EFFECTIVE_UNSUPPORTED'
                ? t('config.toolsInvokeEffectiveUnavailable', 'OpenClaw did not advertise tools.effective, so JunQi cannot verify an invokable tool for this Session.')
                : t('config.toolsInvokeEffectiveError', 'OpenClaw did not return a valid effective tool snapshot.')}</span>
            </div>
          ) : isLoadingSelected && !selectedResult ? (
            <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
              {t('config.toolsInvokeEffectiveLoading', 'Loading the effective tool snapshot…')}
            </div>
          ) : selectedResult && tools.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-3 text-xs text-aegis-text-muted">
              <Info size={14} aria-hidden="true" />
              {t('config.toolsInvokeNoEffectiveTools', 'OpenClaw reports no invokable tools for this Session.')}
            </div>
          ) : selectedResult ? (
            <>
              <label className="block text-xs text-aegis-text-muted">
                <span className="mb-1.5 block">{t('config.toolsInvokeTool', 'Tool')}</span>
                <select
                  value={selectedToolName}
                  onChange={(event) => {
                    setSelectedToolName(event.target.value);
                    setResult(null);
                    setLocalError(null);
                  }}
                  className="w-full rounded-lg border border-aegis-border bg-aegis-overlay px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-accent"
                >
                  {tools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.label} · {tool.id}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTool ? (
                <div className="rounded-lg border border-aegis-border/70 bg-aegis-overlay/40 px-3 py-2 text-xs text-aegis-text-muted">
                  <div className="font-mono text-[10px] text-aegis-text">{selectedTool.id}</div>
                  <p className="mt-1 whitespace-pre-wrap">{selectedTool.description}</p>
                </div>
              ) : null}

              <label className="block text-xs text-aegis-text-muted">
                <span className="mb-1.5 block">{t('config.toolsInvokeArgs', 'Arguments')}</span>
                <textarea
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                  spellCheck={false}
                  rows={6}
                  className="w-full resize-y rounded-lg border border-aegis-border bg-aegis-overlay px-3 py-2 font-mono text-xs text-aegis-text outline-none focus:border-aegis-accent"
                  aria-label={t('config.toolsInvokeArgs', 'Arguments')}
                />
              </label>

              <label className="flex items-start gap-2 text-xs text-aegis-text-muted">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(event) => setConfirm(event.target.checked)}
                  className="mt-0.5 accent-aegis-accent"
                />
                <span>{t('config.toolsInvokeConfirm', 'Ask the OpenClaw Gateway to request approval when its policy requires it.')}</span>
              </label>

              <button
                type="button"
                onClick={() => void submit()}
                disabled={!selectedToolName || invoking}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-aegis-accent/40 bg-aegis-accent/15 px-3 py-2 text-xs font-medium text-aegis-text transition-colors hover:bg-aegis-accent/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={14} aria-hidden="true" />
                {invoking ? t('config.toolsInvokeRunning', 'Waiting for OpenClaw…') : t('config.toolsInvokeRun', 'Invoke tool')}
              </button>
            </>
          ) : null}

          {localError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-xs text-red-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{localError}</span>
            </div>
          ) : null}

          {result ? (
            <div className={`rounded-lg border px-3 py-3 text-xs ${result.ok
              ? 'border-green-500/30 bg-green-500/10 text-green-100'
              : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-100'}`}>
              <div className="flex items-center gap-2 font-medium">
                {result.ok
                  ? <CheckCircle2 size={14} aria-hidden="true" />
                  : <AlertTriangle size={14} aria-hidden="true" />}
                <span>{result.ok
                  ? t('config.toolsInvokeSucceeded', 'OpenClaw returned a tool result.')
                  : result.requiresApproval
                    ? t('config.toolsInvokeApprovalRequired', 'OpenClaw requires approval before this tool can run.')
                    : t('config.toolsInvokeRejected', 'OpenClaw rejected this tool invocation.')}</span>
              </div>
              <div className="mt-2 font-mono text-[10px] opacity-80">{result.toolName}</div>
              {result.error ? (
                <div className="mt-2 whitespace-pre-wrap">{result.error.code}: {result.error.message}</div>
              ) : null}
              {result.approvalId ? (
                <div className="mt-2 font-mono text-[10px] opacity-80">
                  {t('config.toolsInvokeApprovalId', 'Approval')}: {result.approvalId}
                </div>
              ) : null}
              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-current/15 bg-black/10 p-2 font-mono text-[11px]">
                {formatToolValue(
                  result.ok ? result.output : result.error?.details,
                  t('config.toolsInvokeNoOutput', 'OpenClaw returned no structured output.'),
                )}
              </pre>
            </div>
          ) : null}
        </div>
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
      'This OpenClaw Gateway does not support tools.effective for the current connection.',
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
      <div className="space-y-4">
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {t(
            'config.runtimeSchemaRequired',
            'The selected OpenClaw Runtime schema is unavailable. Tool settings are read-only; use the raw editor or official OpenClaw Wizard after the Runtime is available.',
          )}
          {error ? <p className="mt-1 text-xs opacity-80">{error}</p> : null}
        </div>
        <ToolsCatalogPanel />
        <EffectiveToolsPanel />
        <ToolInvokePanel />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ToolsCatalogPanel />
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
      <EffectiveToolsPanel />
      <ToolInvokePanel />
    </div>
  );
}

export default ToolsTab;
