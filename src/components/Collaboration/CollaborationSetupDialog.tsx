import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Clipboard,
  Container,
  HardDrive,
  Loader2,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  TriangleAlert,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  collaborationConfigurationMatches,
  type CollaborationAgentConfigurationDraft,
  type CollaborationSetupResult,
} from '@/stores/collaborationSetupStore';
import type { CollaborationCapabilities } from '@/services/collaboration/types';
import {
  deriveCollaborationSetupView,
  useCollaborationSetupStore,
  type CollaborationSetupMutation,
  type CollaborationSetupViewDecision,
} from '@/stores/collaborationSetupStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  CollaborationBootstrapProbe,
  CollaborationBootstrapStatus,
} from '@/types/collaborationBootstrap';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

interface CollaborationSetupPanelProps {
  decision: CollaborationSetupViewDecision;
  identity: RuntimeIdentity | null;
  probe: CollaborationBootstrapProbe | null;
  status: CollaborationBootstrapStatus | null;
  capabilities: CollaborationCapabilities | null;
  agentConfiguration: CollaborationAgentConfigurationDraft;
  bundle: {
    pluginVersion: string;
    schemaVersion: number;
    sha256: string;
    archiveFile: string;
  };
  resolvedBundlePath: string | null;
  mutation: CollaborationSetupMutation | null;
  lastResult: CollaborationSetupResult | null;
  error: string | null;
  restartAvailable: boolean;
  rollbackConfirmed: boolean;
  onRollbackConfirmedChange: (confirmed: boolean) => void;
  orphanAbandonConfirmed: boolean;
  onOrphanAbandonConfirmedChange: (confirmed: boolean) => void;
  onRefresh: () => void;
  onApply: () => void;
  onSelectCoordinator: (agentId: string) => void;
  onSetAgentAllowed: (agentId: string, allowed: boolean) => void;
  onConfigureAgents: () => void;
  onCreateAgent: () => void;
  onRecover: (strategy: 'resume' | 'rollback') => void;
  onAbandonOrphan: () => void;
  onRestart: () => void;
}

const buttonBase = 'inline-flex min-h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/45 disabled:cursor-not-allowed disabled:opacity-45';

function targetLabel(targetClass: CollaborationSetupViewDecision['targetClass']): string {
  const labels: Record<CollaborationSetupViewDecision['targetClass'], string> = {
    native_managed: 'Managed child',
    system_service: 'System service',
    docker: 'Persistent Docker',
    external_local: 'External local',
    external_remote: 'External remote',
    unknown: 'Unknown target',
  };
  return labels[targetClass];
}

function targetIcon(targetClass: CollaborationSetupViewDecision['targetClass']) {
  if (targetClass === 'docker') return Container;
  if (targetClass === 'system_service') return Server;
  return HardDrive;
}

function shortFingerprint(value: string | null | undefined): string {
  if (!value) return 'Unavailable';
  return value.length > 22 ? `${value.slice(0, 10)}...${value.slice(-8)}` : value;
}

function statusTone(ok: boolean): string {
  return ok ? 'text-aegis-success' : 'text-aegis-warning';
}

function DecisionMessage({ decision }: { decision: CollaborationSetupViewDecision }) {
  const { t } = useTranslation();
  const content: Record<CollaborationSetupViewDecision['kind'], { title: string; body: string }> = {
    loading: {
      title: t('collaboration.bootstrap.loadingTitle', 'Inspecting collaboration runtime'),
      body: t('collaboration.bootstrap.loadingBody', 'JunQi is verifying the target, plugin and recovery journal.'),
    },
    identity_unavailable: {
      title: t('collaboration.bootstrap.identityTitle', 'Verified Gateway required'),
      body: t('collaboration.bootstrap.identityBody', 'Connect to the intended Gateway and wait for its runtime identity to be verified.'),
    },
    busy: {
      title: t('collaboration.bootstrap.busyTitle', 'Runtime operation in progress'),
      body: t('collaboration.bootstrap.busyBody', 'Keep this window open. The durable journal will preserve recovery state if the operation is interrupted.'),
    },
    recovery: {
      title: t('collaboration.bootstrap.recoveryTitle', 'Installation recovery required'),
      body: t('collaboration.bootstrap.recoveryBody', 'An earlier operation did not finish cleanly. Resume it or restore the exact previous plugin state.'),
    },
    health_pending: {
      title: t('collaboration.bootstrap.healthTitle', 'Gateway restart and health check pending'),
      body: t('collaboration.bootstrap.healthBody', 'The fixed package is applied. Restart this Gateway, reconnect, and JunQi will confirm the exact plugin capabilities automatically.'),
    },
    manual: {
      title: t('collaboration.bootstrap.manualTitle', 'External runtime stays read only'),
      body: t('collaboration.bootstrap.manualBody', 'JunQi will not change this target. Transfer the fixed archive and run the verified commands on the machine that owns the Gateway.'),
    },
    runtime_not_durable: {
      title: t('collaboration.bootstrap.durableTitle', 'Move to a persistent runtime first'),
      body: t('collaboration.bootstrap.durableBody', 'This managed child exits with JunQi. Use a system service or persistent Docker target before enabling collaboration.'),
    },
    unsupported: {
      title: t('collaboration.bootstrap.unsupportedTitle', 'Runtime cannot be changed safely'),
      body: t('collaboration.bootstrap.unsupportedBody', 'JunQi could not prove ownership and runtime paths, so mutation remains disabled.'),
    },
    install: {
      title: t('collaboration.bootstrap.installTitle', 'Install collaboration capability'),
      body: t('collaboration.bootstrap.installBody', 'JunQi will install only the bundled, SHA-256 verified plugin archive shown below.'),
    },
    repair: {
      title: t('collaboration.bootstrap.repairTitle', 'Repair collaboration plugin'),
      body: t('collaboration.bootstrap.repairBody', 'The plugin exists but is disabled or unhealthy. Reapply the fixed bundle to restore its loadable state.'),
    },
    update: {
      title: t('collaboration.bootstrap.updateTitle', 'Update collaboration plugin'),
      body: t('collaboration.bootstrap.updateBody', 'The installed version differs from the version bundled with this JunQi release.'),
    },
    ready: {
      title: t('collaboration.bootstrap.readyTitle', 'Collaboration plugin is ready'),
      body: t('collaboration.bootstrap.readyBody', 'The expected plugin version is loaded on a persistent runtime.'),
    },
    error: {
      title: t('collaboration.bootstrap.errorTitle', 'Runtime inspection failed'),
      body: t('collaboration.bootstrap.errorBody', 'Review the diagnostic below, then verify the Gateway and retry.'),
    },
  };
  const message = content[decision.kind];
  const Icon = decision.kind === 'ready'
    ? CheckCircle2
    : decision.kind === 'error' || decision.kind === 'unsupported'
      ? TriangleAlert
      : decision.kind === 'loading' || decision.kind === 'busy'
        ? Loader2
        : decision.kind === 'recovery'
          ? Wrench
          : AlertTriangle;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2.5',
        decision.kind === 'ready'
          ? 'border-aegis-success/25 bg-aegis-success/[0.055]'
          : decision.kind === 'error' || decision.kind === 'unsupported'
            ? 'border-aegis-danger/25 bg-aegis-danger/[0.055]'
            : 'border-aegis-warning/25 bg-aegis-warning/[0.055]',
      )}
      data-collaboration-bootstrap-view={decision.kind}
    >
      <Icon
        size={17}
        className={cn(
          'mt-0.5 shrink-0',
          (decision.kind === 'loading' || decision.kind === 'busy') && 'animate-spin',
          decision.kind === 'ready' ? 'text-aegis-success' : decision.kind === 'error' ? 'text-aegis-danger' : 'text-aegis-warning',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <h3 className="text-[12px] font-semibold text-aegis-text-secondary">{message.title}</h3>
        <p className="mt-0.5 max-w-[72ch] text-[10.5px] leading-4 text-aegis-text-muted">{message.body}</p>
        {decision.blockedReason && (
          <p className="mt-1 break-words text-[10px] leading-4 text-aegis-text-dim">{decision.blockedReason}</p>
        )}
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => undefined);
      }}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-aegis-text-dim hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
    >
      {copied ? <Check size={13} aria-hidden /> : <Clipboard size={13} aria-hidden />}
    </button>
  );
}

export function CollaborationSetupPanel({
  decision,
  identity,
  probe,
  status,
  capabilities,
  agentConfiguration,
  bundle,
  resolvedBundlePath,
  mutation,
  lastResult,
  error,
  restartAvailable,
  rollbackConfirmed,
  onRollbackConfirmedChange,
  orphanAbandonConfirmed,
  onOrphanAbandonConfirmedChange,
  onRefresh,
  onApply,
  onSelectCoordinator,
  onSetAgentAllowed,
  onConfigureAgents,
  onCreateAgent,
  onRecover,
  onAbandonOrphan,
  onRestart,
}: CollaborationSetupPanelProps) {
  const { t } = useTranslation();
  const TargetIcon = targetIcon(decision.targetClass);
  const journal = status?.journal;
  const plugin = probe?.plugin;
  const resultWarnings = lastResult && 'warnings' in lastResult ? lastResult.warnings : [];
  const warnings = [...new Set([...(probe?.warnings ?? []), ...resultWarnings])];
  const manualInstruction = probe?.manualInstallInstructions;
  const manualArchive = resolvedBundlePath || t('collaboration.bootstrap.bundleInApp', 'JunQi application resource: collaboration/junqi-collab.tgz');
  const targetArchive = '/path/on/target/junqi-collab.tgz';
  const manualCommands = [
    `sha256sum ${targetArchive}`,
    `openclaw plugins install --force --pin ${targetArchive}`,
    'openclaw plugins enable junqi-collab',
    'openclaw gateway restart',
  ].join('\n');
  const pluginReady = Boolean(plugin?.installed && plugin.enabled && plugin.status === 'loaded');
  const availableAgents = capabilities?.configuredAgents ?? [];
  const activeCollaborationCount = capabilities?.maintenance?.activeRuns?.length ?? 0;
  const agentPolicyMutationBlocked = capabilities?.maintenance?.active !== false
    || activeCollaborationCount > 0;
  const configurationConfirmed = Boolean(
    capabilities
    && agentConfiguration.coordinatorAgentId
    && collaborationConfigurationMatches(
      capabilities,
      agentConfiguration.coordinatorAgentId,
      agentConfiguration.allowedAgentIds,
    ),
  );
  const canConfigureAgents = Boolean(
    decision.kind === 'ready'
    && capabilities
    && availableAgents.length > 0
    && agentConfiguration.coordinatorAgentId
    && agentConfiguration.allowedAgentIds.includes(agentConfiguration.coordinatorAgentId)
    && !configurationConfirmed
    && !agentPolicyMutationBlocked
    && !mutation,
  );

  return (
    <div className="min-h-0 space-y-3 overflow-y-auto px-5 pb-5">
      <DecisionMessage decision={decision} />

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <section className="rounded-md border border-aegis-border bg-aegis-surface-solid p-3" aria-label={t('collaboration.bootstrap.target', 'Runtime target')}>
          <div className="flex items-center gap-2">
            <TargetIcon size={15} className="text-aegis-text-muted" aria-hidden />
            <h3 className="text-[11px] font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.target', 'Runtime target')}</h3>
            <span className="ms-auto text-[10px] font-medium text-aegis-text-muted">{targetLabel(decision.targetClass)}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] leading-4">
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.identity', 'Identity')}</dt>
            <dd className={statusTone(Boolean(identity?.verified))}>{identity?.verified ? t('collaboration.bootstrap.verified', 'Verified') : t('collaboration.bootstrap.unverified', 'Unavailable')}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.gateway', 'Gateway')}</dt>
            <dd className="truncate font-mono text-aegis-text-muted" title={identity?.gatewayVersion}>{identity?.gatewayVersion || 'Unknown'}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.fingerprint', 'Fingerprint')}</dt>
            <dd className="truncate font-mono text-aegis-text-muted" title={identity?.targetFingerprint}>{shortFingerprint(identity?.targetFingerprint)}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.continuity', 'Desktop exit')}</dt>
            <dd className={statusTone(Boolean(identity?.desktopExitContinuity))}>{identity?.desktopExitContinuity ? t('collaboration.bootstrap.continues', 'Continues running') : t('collaboration.bootstrap.stops', 'Stops or unknown')}</dd>
          </dl>
        </section>

        <section className="rounded-md border border-aegis-border bg-aegis-surface-solid p-3" aria-label={t('collaboration.bootstrap.plugin', 'Plugin state')}>
          <div className="flex items-center gap-2">
            <Plug size={15} className="text-aegis-text-muted" aria-hidden />
            <h3 className="text-[11px] font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.plugin', 'Plugin state')}</h3>
            <span className={cn('ms-auto text-[10px] font-medium', statusTone(pluginReady))}>
              {pluginReady ? t('collaboration.bootstrap.loaded', 'Loaded') : plugin?.installed ? t('collaboration.bootstrap.needsRepair', 'Needs repair') : t('collaboration.bootstrap.notInstalled', 'Not installed')}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] leading-4">
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.installedVersion', 'Installed')}</dt>
            <dd className="font-mono text-aegis-text-muted">{plugin?.version || 'None'}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.expectedVersion', 'This JunQi')}</dt>
            <dd className="font-mono text-aegis-text-muted">{bundle.pluginVersion}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.schema', 'Schema')}</dt>
            <dd className="font-mono text-aegis-text-muted">{bundle.schemaVersion}</dd>
            <dt className="text-aegis-text-dim">{t('collaboration.bootstrap.configured', 'Agent config')}</dt>
            <dd className={statusTone(capabilities?.configured === true)}>{capabilities?.configured === true ? t('collaboration.bootstrap.configuredYes', 'Configured') : t('collaboration.bootstrap.configuredNo', 'Not confirmed')}</dd>
          </dl>
        </section>
      </div>

      <section className="rounded-md border border-aegis-border px-3 py-2.5" aria-label={t('collaboration.bootstrap.fixedPackage', 'Fixed plugin package')}>
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-aegis-primary" aria-hidden />
          <h3 className="text-[11px] font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.fixedPackage', 'Fixed plugin package')}</h3>
          <span className="ms-auto font-mono text-[10px] text-aegis-text-muted">v{bundle.pluginVersion}</span>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-2 rounded bg-[rgb(var(--aegis-overlay)/0.035)] px-2 py-1.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[9.5px] leading-4 text-aegis-text-dim">SHA-256 {bundle.sha256}</code>
          <CopyButton value={bundle.sha256} label={t('collaboration.bootstrap.copyHash', 'Copy SHA-256')} />
        </div>
        <p className="mt-1.5 text-[9.5px] leading-4 text-aegis-text-dim">
          {t('collaboration.bootstrap.noPicker', 'Package selection is locked to the archive shipped with this JunQi build. Arbitrary files are not accepted by this workflow.')}
        </p>
      </section>

      {pluginReady && (
        <section
          className={cn(
            'rounded-md border px-3 py-2.5',
            configurationConfirmed
              ? 'border-aegis-success/25 bg-aegis-success/[0.035]'
              : 'border-aegis-warning/25 bg-aegis-warning/[0.04]',
          )}
          aria-label={t('collaboration.bootstrap.agentConfigTitle', 'Agent policy')}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Bot size={15} className={configurationConfirmed ? 'text-aegis-success' : 'text-aegis-warning'} aria-hidden />
            <h3 className="min-w-0 text-[11px] font-semibold text-aegis-text-secondary">
              {t('collaboration.bootstrap.agentConfigTitle', 'Agent policy')}
            </h3>
            <span className={cn('ms-auto shrink-0 text-[10px] font-medium', configurationConfirmed ? 'text-aegis-success' : 'text-aegis-warning')}>
              {configurationConfirmed
                ? t('collaboration.bootstrap.policyActive', 'Active')
                : t('collaboration.bootstrap.policyRequired', 'Setup required')}
            </span>
          </div>

          {!capabilities && (
            <p className="mt-2 text-[10px] leading-4 text-aegis-text-muted">
              {t('collaboration.bootstrap.capabilitiesUnavailable', 'Reconnect or refresh to read the live OpenClaw Agent registry.')}
            </p>
          )}

          {capabilities && availableAgents.length === 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-aegis-border/70 pt-2">
              <p className="text-[10px] leading-4 text-aegis-text-muted">
                {t('collaboration.bootstrap.noConfigAgents', 'No OpenClaw Agent is configured on this Gateway.')}
              </p>
              <button
                type="button"
                className={cn(buttonBase, 'border-aegis-primary/35 text-aegis-primary hover:bg-aegis-primary/[0.07]')}
                disabled={Boolean(mutation)}
                onClick={onCreateAgent}
              >
                <UserPlus size={13} aria-hidden />
                {t('collaboration.bootstrap.createAgent', 'Create Agent')}
              </button>
            </div>
          )}

          {capabilities && availableAgents.length > 0 && (
            <>
              <div className="mt-2 grid grid-cols-1 gap-3 border-t border-aegis-border/70 pt-2 md:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.2fr)]">
                <div className="min-w-0">
                  <label className="mb-1 block text-[10px] font-medium text-aegis-text-muted" htmlFor="collaboration-coordinator">
                    {t('collaboration.bootstrap.coordinatorAgent', 'Coordinator')}
                  </label>
                  <Select
                    value={agentConfiguration.coordinatorAgentId ?? undefined}
                    onValueChange={onSelectCoordinator}
                    disabled={Boolean(mutation)}
                  >
                    <SelectTrigger id="collaboration-coordinator" className="h-9 w-full border-aegis-border bg-aegis-surface-solid text-[11px]">
                      <SelectValue placeholder={t('collaboration.bootstrap.selectCoordinator', 'Select coordinator')} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id} className="text-[11px]">
                          {agent.name?.trim() || agent.id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {agentConfiguration.coordinatorAgentId && (
                    <code className="mt-1 block truncate font-mono text-[9.5px] text-aegis-text-dim" title={agentConfiguration.coordinatorAgentId}>
                      {agentConfiguration.coordinatorAgentId}
                    </code>
                  )}
                </div>

                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-medium text-aegis-text-muted">
                      {t('collaboration.bootstrap.allowedAgents', 'Allowed Agents')}
                    </span>
                    <span className="text-[9.5px] tabular-nums text-aegis-text-dim">
                      {agentConfiguration.allowedAgentIds.length}/{availableAgents.length}
                    </span>
                  </div>
                  <div className="max-h-40 divide-y divide-aegis-border/60 overflow-y-auto border-y border-aegis-border/70">
                    {availableAgents.map((agent) => {
                      const isCoordinator = agent.id === agentConfiguration.coordinatorAgentId;
                      const checked = agentConfiguration.allowedAgentIds.includes(agent.id);
                      return (
                        <label key={agent.id} className="flex min-h-10 cursor-pointer items-center gap-2 px-1 py-1.5 text-[10px] hover:bg-[rgb(var(--aegis-overlay)/0.035)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={Boolean(mutation) || isCoordinator}
                            onChange={(event) => onSetAgentAllowed(agent.id, event.target.checked)}
                            className="h-3.5 w-3.5 shrink-0 accent-[rgb(var(--aegis-primary))]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-aegis-text-secondary" title={agent.name || agent.id}>{agent.name?.trim() || agent.id}</span>
                            <span className="block truncate font-mono text-[9px] text-aegis-text-dim" title={agent.id}>{agent.id}</span>
                          </span>
                          <span className="shrink-0 text-[9px] uppercase text-aegis-text-dim">{agent.runtimeType}</span>
                          {isCoordinator && <span className="shrink-0 text-[9px] font-medium text-aegis-primary">{t('collaboration.bootstrap.coordinatorShort', 'Coordinator')}</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {capabilities.repairs.length > 0 && (
                <ul className="mt-2 space-y-1 text-[9.5px] leading-4 text-aegis-text-dim">
                  {capabilities.repairs.map((repair) => <li key={repair}>{repair}</li>)}
                </ul>
              )}

              {agentPolicyMutationBlocked && (
                <p className="mt-2 text-[9.5px] leading-4 text-aegis-warning">
                  {capabilities.maintenance?.active
                    ? t('collaboration.bootstrap.policyMaintenanceBlocked', 'Finish the current maintenance operation before changing this policy.')
                    : t('collaboration.bootstrap.policyRunsBlocked', 'Finish {{count}} active collaboration run(s) before changing this policy.', { count: activeCollaborationCount })}
                </p>
              )}

              <div className="mt-2 flex justify-end border-t border-aegis-border/70 pt-2">
                <button
                  type="button"
                  className={cn(buttonBase, 'border-aegis-primary/35 bg-aegis-primary text-white hover:bg-aegis-primary/90')}
                  disabled={!canConfigureAgents}
                  onClick={onConfigureAgents}
                >
                  {mutation === 'configure' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Save size={13} aria-hidden />}
                  {configurationConfirmed
                    ? t('collaboration.bootstrap.policySaved', 'Policy active')
                    : t('collaboration.bootstrap.savePolicy', 'Save policy')}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {decision.kind === 'recovery' && journal && (
        <section className="rounded-md border border-aegis-warning/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
            <span className="font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.operation', 'Operation')}</span>
            <code className="font-mono text-aegis-text-muted">{journal.operationId}</code>
            <span className="text-aegis-text-dim">{journal.steps.length} {t('collaboration.bootstrap.journalSteps', 'journal steps')}</span>
          </div>
          {decision.canRecover && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded bg-aegis-danger/[0.045] px-2.5 py-2 text-[10px] leading-4 text-aegis-text-muted">
              <input
                type="checkbox"
                checked={rollbackConfirmed}
                onChange={(event) => onRollbackConfirmedChange(event.target.checked)}
                className="mt-0.5 accent-[rgb(var(--aegis-danger))]"
              />
              <span>{t('collaboration.bootstrap.rollbackConfirm', 'I understand that rollback restores the exact previous plugin and configuration state.')}</span>
            </label>
          )}
          {decision.canAbandon && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded bg-aegis-warning/[0.055] px-2.5 py-2 text-[10px] leading-4 text-aegis-text-muted">
              <input
                type="checkbox"
                checked={orphanAbandonConfirmed}
                onChange={(event) => onOrphanAbandonConfirmedChange(event.target.checked)}
                className="mt-0.5 accent-[rgb(var(--aegis-warning))]"
              />
              <span>{t('collaboration.bootstrap.abandonConfirm', 'Archive the old target journal and every recovery backup as retained evidence. This does not roll back or modify the old target.')}</span>
            </label>
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {decision.canRecover && (
              <>
                <button type="button" className={cn(buttonBase, 'border-aegis-border text-aegis-text-secondary hover:bg-[rgb(var(--aegis-overlay)/0.05)]')} disabled={Boolean(mutation)} onClick={() => onRecover('resume')}>
                  <RefreshCw size={13} aria-hidden />{t('collaboration.bootstrap.resume', 'Resume')}
                </button>
                <button type="button" className={cn(buttonBase, 'border-aegis-danger/35 text-aegis-danger hover:bg-aegis-danger/[0.07]')} disabled={!rollbackConfirmed || Boolean(mutation)} onClick={() => onRecover('rollback')}>
                  <RotateCcw size={13} aria-hidden />{t('collaboration.bootstrap.rollback', 'Roll back')}
                </button>
              </>
            )}
            {decision.canAbandon && (
              <button type="button" className={cn(buttonBase, 'border-aegis-warning/35 text-aegis-warning hover:bg-aegis-warning/[0.07]')} disabled={!orphanAbandonConfirmed || Boolean(mutation)} onClick={onAbandonOrphan}>
                <ShieldCheck size={13} aria-hidden />{t('collaboration.bootstrap.archiveOrphan', 'Archive old recovery evidence')}
              </button>
            )}
          </div>
        </section>
      )}

      {decision.kind === 'health_pending' && (
        <section className="rounded-md border border-aegis-primary/25 bg-aegis-primary/[0.045] px-3 py-2.5">
          <h3 className="text-[11px] font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.restartRequired', 'Restart required')}</h3>
          <p className="mt-1 text-[10px] leading-4 text-aegis-text-muted">
            {journal?.status === 'rolled_back'
              ? t('collaboration.bootstrap.rollbackRestart', 'Restart this verified target to activate the restored plugin and configuration state. No collaboration health confirmation is required after rollback.')
              : restartAvailable
              ? t('collaboration.bootstrap.restartAvailable', 'Restart this verified target. Health remains pending until a new Gateway connection advertises the exact durable capabilities.')
              : t('collaboration.bootstrap.restartManual', 'Restart this target with its current supervisor, then reconnect JunQi. Health confirmation will run automatically after the new handshake.')}
          </p>
          {decision.canRecover && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 rounded bg-aegis-danger/[0.045] px-2.5 py-2 text-[10px] leading-4 text-aegis-text-muted">
              <input
                type="checkbox"
                checked={rollbackConfirmed}
                onChange={(event) => onRollbackConfirmedChange(event.target.checked)}
                className="mt-0.5 accent-[rgb(var(--aegis-danger))]"
              />
              <span>{t('collaboration.bootstrap.healthRollbackConfirm', 'The applied plugin has not been confirmed healthy. Restore the exact previous plugin and configuration state.')}</span>
            </label>
          )}
          {(restartAvailable || decision.canRecover) && (
            <div className="mt-2 flex flex-wrap justify-end gap-2">
              {decision.canRecover && (
                <button type="button" className={cn(buttonBase, 'border-aegis-danger/35 text-aegis-danger hover:bg-aegis-danger/[0.07]')} disabled={!rollbackConfirmed || Boolean(mutation)} onClick={() => onRecover('rollback')}>
                  <RotateCcw size={13} aria-hidden />{t('collaboration.bootstrap.rollback', 'Roll back')}
                </button>
              )}
              {restartAvailable && (
              <button type="button" className={cn(buttonBase, 'border-aegis-primary/35 bg-aegis-primary text-white hover:bg-aegis-primary/90')} disabled={Boolean(mutation)} onClick={onRestart}>
                <RotateCcw size={13} aria-hidden />{t('collaboration.bootstrap.restartGateway', 'Restart Gateway')}
              </button>
              )}
            </div>
          )}
        </section>
      )}

      {decision.kind === 'manual' && (
        <section className="rounded-md border border-aegis-border px-3 py-2.5">
          <h3 className="text-[11px] font-semibold text-aegis-text-secondary">{t('collaboration.bootstrap.manualSteps', 'Manual installation on the target')}</h3>
          {manualInstruction && <p className="mt-1 text-[10px] leading-4 text-aegis-text-muted">{manualInstruction}</p>}
          <ol className="mt-2 list-decimal space-y-1 ps-4 text-[10px] leading-4 text-aegis-text-muted">
            <li>{t('collaboration.bootstrap.transferArchive', 'Transfer the exact archive below to the Gateway host.')}</li>
            <li>{t('collaboration.bootstrap.verifyHash', 'Verify its SHA-256 equals the value shown above.')}</li>
            <li>{t('collaboration.bootstrap.runCommands', 'Run the commands on the target, then reconnect JunQi.')}</li>
          </ol>
          <div className="mt-2 flex min-w-0 items-center gap-2 rounded bg-[rgb(var(--aegis-overlay)/0.04)] px-2 py-1.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[9.5px] text-aegis-text-dim">{manualArchive}</code>
            <CopyButton value={manualArchive} label={t('collaboration.bootstrap.copyArchivePath', 'Copy archive path')} />
          </div>
          <div className="mt-2 flex min-w-0 items-start gap-2 rounded bg-[rgb(var(--aegis-overlay)/0.04)] px-2 py-1.5">
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[9.5px] leading-4 text-aegis-text-dim">{manualCommands}</pre>
            <CopyButton value={manualCommands} label={t('collaboration.bootstrap.copyCommands', 'Copy commands')} />
          </div>
        </section>
      )}

      {warnings.length > 0 && (
        <section className="rounded-md border border-aegis-warning/25 px-3 py-2.5" aria-label={t('collaboration.bootstrap.warnings', 'Warnings')}>
          <h3 className="flex items-center gap-1.5 text-[10.5px] font-semibold text-aegis-warning"><AlertTriangle size={13} aria-hidden />{t('collaboration.bootstrap.warnings', 'Warnings')}</h3>
          <ul className="mt-1.5 space-y-1 text-[10px] leading-4 text-aegis-text-muted">
            {warnings.map((warning) => <li key={warning} className="break-words">{warning}</li>)}
          </ul>
        </section>
      )}

      {(error || (lastResult && !lastResult.ok)) && (
        <div role="alert" className="rounded-md border border-aegis-danger/25 bg-aegis-danger/[0.05] px-3 py-2 text-[10px] leading-4 text-aegis-danger">
          {error || lastResult?.message}
        </div>
      )}
      {lastResult?.ok && (
        <div role="status" className="rounded-md border border-aegis-success/25 bg-aegis-success/[0.05] px-3 py-2 text-[10px] leading-4 text-aegis-success">
          {lastResult.message}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-aegis-border pt-3">
        <button type="button" className={cn(buttonBase, 'border-aegis-border text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.05)]')} disabled={Boolean(mutation)} onClick={onRefresh}>
          <RefreshCw size={13} className={mutation ? 'animate-spin' : ''} aria-hidden />
          {t('collaboration.bootstrap.refresh', 'Refresh')}
        </button>
        {(decision.kind === 'install' || decision.kind === 'repair' || decision.kind === 'update') && (
          <button type="button" className={cn(buttonBase, 'border-aegis-primary/35 bg-aegis-primary text-white hover:bg-aegis-primary/90')} disabled={!decision.canApply || Boolean(mutation)} onClick={onApply}>
            {mutation === 'apply' ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Plug size={13} aria-hidden />}
            {decision.kind === 'install'
              ? t('collaboration.bootstrap.install', 'Install fixed plugin')
              : decision.kind === 'update'
                ? t('collaboration.bootstrap.update', 'Update fixed plugin')
                : t('collaboration.bootstrap.repair', 'Repair fixed plugin')}
          </button>
        )}
      </div>
    </div>
  );
}

export function CollaborationSetupDialog() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useCollaborationSetupStore();
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const [orphanAbandonConfirmed, setOrphanAbandonConfirmed] = useState(false);
  const decision = useMemo(() => deriveCollaborationSetupView(state), [state]);

  useEffect(() => {
    if (decision.kind !== 'recovery' && !(decision.kind === 'health_pending' && decision.canRecover)) {
      setRollbackConfirmed(false);
    }
    if (decision.kind !== 'recovery' || !decision.canAbandon) setOrphanAbandonConfirmed(false);
  }, [decision.canAbandon, decision.canRecover, decision.kind]);

  return (
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) state.close(); }}>
      <DialogContent className="max-h-[min(760px,92dvh)] w-[min(760px,calc(100vw-24px))] max-w-none gap-0 overflow-hidden border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text shadow-float sm:rounded-lg">
        <DialogHeader className="border-b border-aegis-border px-5 py-4 pe-12 text-start">
          <DialogTitle className="text-[15px] font-semibold text-aegis-text">
            {t('collaboration.bootstrap.title', 'Collaboration runtime')}
          </DialogTitle>
          <DialogDescription className="mt-1 text-[10.5px] leading-4 text-aegis-text-muted">
            {t('collaboration.bootstrap.description', 'Install, recover and verify the durable OpenClaw collaboration plugin for the currently connected runtime.')}
          </DialogDescription>
        </DialogHeader>
        <CollaborationSetupPanel
          decision={decision}
          identity={state.identity}
          probe={state.probe}
          status={state.status}
          capabilities={state.capabilities}
          agentConfiguration={state.agentConfiguration}
          bundle={state.bundle}
          resolvedBundlePath={state.resolvedBundlePath}
          mutation={state.mutation}
          lastResult={state.lastResult}
          error={state.error}
          restartAvailable={state.restartAvailable}
          rollbackConfirmed={rollbackConfirmed}
          onRollbackConfirmedChange={setRollbackConfirmed}
          orphanAbandonConfirmed={orphanAbandonConfirmed}
          onOrphanAbandonConfirmedChange={setOrphanAbandonConfirmed}
          onRefresh={() => void state.refresh({ clearError: true })}
          onApply={() => void state.applyFixedBundle()}
          onSelectCoordinator={state.selectCoordinatorAgent}
          onSetAgentAllowed={state.setAgentAllowed}
          onConfigureAgents={() => void state.configureAgents()}
          onCreateAgent={() => {
            state.close();
            navigate('/agents?new=1');
          }}
          onRecover={(strategy) => void state.recover(strategy)}
          onAbandonOrphan={() => void state.abandonOrphan()}
          onRestart={() => void state.requestRestart()}
        />
      </DialogContent>
    </Dialog>
  );
}
