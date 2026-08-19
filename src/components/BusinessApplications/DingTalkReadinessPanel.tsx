import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CircleDashed, Copy, ExternalLink, RefreshCw, Square, Terminal, Wrench } from 'lucide-react';
import { Button } from '@/components/shared/button/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';
import { DingTalkRuntimeIdentity } from './DingTalkRuntimeIdentity';
import { resolveDingTalkReadiness } from './dingTalkReadiness';
import { useSetupProgress } from '@/hooks/useSetupProgress';

const DWS_OFFICIAL_GUIDE = 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#installation';
const DWS_INSTALL_COMMANDS = [
  { label: 'macOS / Linux', command: 'curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh' },
  { label: 'Windows PowerShell', command: 'irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex' },
  { label: 'Node.js / npm', command: 'npm install -g dingtalk-workspace-cli' },
] as const;

type ReadinessStepState = 'ready' | 'pending' | 'blocked';

function ReadinessStep({
  label,
  state,
  description,
}: {
  label: string;
  state: ReadinessStepState;
  description: string;
}) {
  const { t } = useTranslation();
  const Icon = state === 'ready' ? CircleCheck : state === 'blocked' ? CircleAlert : CircleDashed;
  const stateLabel = t(`businessApplications.readiness.stepState.${state}`);
  const stateClass = state === 'ready'
    ? 'text-aegis-success'
    : state === 'blocked' ? 'text-aegis-warning' : 'text-aegis-text-dim';
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2 border-b border-aegis-border/70 py-2 last:border-b-0">
      <Icon size={14} className={`mt-0.5 ${stateClass}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-[10.5px] font-medium text-aegis-text-secondary">{label}</div>
        <div className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">{description}</div>
      </div>
      <span className={`text-[9.5px] ${stateClass}`}>{stateLabel}</span>
    </div>
  );
}

export type DingTalkPluginInstallProgress = {
  readonly phase: 'idle' | 'checking' | 'installing' | 'completed' | 'failed';
  readonly message: string | null;
};

export type DingTalkDwsOperationPresentation = {
  readonly id: string;
  readonly kind: 'install' | 'authorize';
  readonly phase: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly message: string | null;
};

export type DingTalkAuthorizationAgentOption = {
  readonly id: string;
  readonly name?: string;
};

export function DingTalkReadinessPanel({
  sessionExists,
  runtimeToolAvailable,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  pluginStatusPending,
  restartRequired,
  agentId,
  authorizationAgentOptions,
  authorizationTargetAgentId,
  installAvailable,
  installationProgress,
  dwsOperation,
  dwsOutput,
  busy,
  refreshing,
  operation,
  sessionLabel,
  effectiveToolCount,
  pluginVersion,
  bundledPluginVersion,
  variant = 'banner',
  hideWhenReady = false,
  onRefresh,
  onInstallPlugin,
  onAuthorizeAgent,
  onAuthorizationTargetAgentChange,
  onRestartGateway,
  onInstallDws,
  onAuthorizeDws,
  onCancelDws,
  onDismissDws,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  pluginStatusPending: boolean;
  restartRequired: boolean;
  agentId: string | null;
  authorizationAgentOptions: readonly DingTalkAuthorizationAgentOption[];
  authorizationTargetAgentId: string | null;
  installAvailable: boolean;
  installationProgress: DingTalkPluginInstallProgress;
  dwsOperation: DingTalkDwsOperationPresentation | null;
  dwsOutput: readonly string[];
  busy: boolean;
  refreshing: boolean;
  operation: 'installing' | 'authorizing' | 'restarting' | null;
  sessionLabel: string | null;
  effectiveToolCount: number;
  pluginVersion: string | null;
  bundledPluginVersion: string | null;
  variant?: 'banner' | 'workspace';
  hideWhenReady?: boolean;
  onRefresh: () => void;
  onInstallPlugin: () => void;
  onAuthorizeAgent: (agentId: string) => void;
  onAuthorizationTargetAgentChange: (agentId: string) => void;
  onRestartGateway: () => void;
  onInstallDws: () => void;
  onAuthorizeDws: () => void;
  onCancelDws: () => void;
  onDismissDws: () => void;
}) {
  const { t } = useTranslation();
  const gatewayProgress = useSetupProgress('gateway');
  const gatewayLifecycleActive = gatewayProgress?.status === 'running';
  const [guideOpen, setGuideOpen] = useState(false);
  const [authorizationGuideOpen, setAuthorizationGuideOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const readiness = resolveDingTalkReadiness({
    sessionExists,
    runtimeToolAvailable,
    runtime,
    runtimeError,
    pluginNeedsInstall,
    pluginStatusPending,
    restartRequired,
    agentId,
  });
  if (hideWhenReady && readiness.tone === 'ready') return null;
  const Icon = readiness.tone === 'ready' ? CircleCheck : CircleAlert;
  const toneClass = readiness.tone === 'ready'
    ? 'border-aegis-success/25 bg-aegis-success/[0.05] text-aegis-success'
    : readiness.tone === 'blocked'
      ? 'border-aegis-warning/30 bg-aegis-warning/[0.06] text-aegis-warning'
      : 'border-aegis-border bg-aegis-surface/45 text-aegis-text-dim';
  const openGuide = () => setGuideOpen(true);
  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
    } catch {
      setCopiedCommand(null);
    }
  };
  const dwsOperationActive = dwsOperation?.phase === 'running';
  const refreshDisabled = !sessionExists || busy || refreshing;
  const description = readiness.action === 'install-plugin' && !installAvailable
    ? t('businessApplications.readiness.installUnavailable')
    : readiness.rawDescription
      ?? t(`businessApplications.readiness.${readiness.descriptionKey}`, readiness.descriptionParams);
  const title = t(`businessApplications.readiness.${readiness.titleKey}`);
  const action = readiness.action === 'install-plugin'
    ? installAvailable
      ? <Button size="xs" variant="outline" tone="primary" loading={busy} leadingIcon={<Wrench size={12} />} onClick={onInstallPlugin} title={t('businessApplications.readiness.installPluginTitle')}>{t('businessApplications.readiness.installInJunqi')}</Button>
      : <Button size="xs" variant="outline" tone="neutral" loading={refreshing} disabled={refreshDisabled} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>{t(refreshing ? 'businessApplications.readiness.refreshing' : 'businessApplications.readiness.refresh')}</Button>
    : readiness.action === 'configure-agent'
      ? <Button size="xs" variant="outline" tone="warning" loading={busy && operation === 'authorizing'} disabled={!authorizationTargetAgentId} onClick={() => setAuthorizationGuideOpen(true)}>{t('businessApplications.readiness.authorizeAgent')}</Button>
    : readiness.action === 'install-dws'
      ? <Button size="xs" variant="outline" tone="warning" disabled={!installAvailable || dwsOperationActive} loading={dwsOperationActive} leadingIcon={<Terminal size={12} />} onClick={onInstallDws} title={t(installAvailable ? 'businessApplications.readiness.installDwsTitle' : 'businessApplications.readiness.runtimeMutationBlocked')}>{t('businessApplications.readiness.installDws')}</Button>
    : readiness.action === 'authorize-dws'
      ? <Button size="xs" variant="outline" tone="primary" disabled={!installAvailable || dwsOperationActive} loading={dwsOperationActive} leadingIcon={<Terminal size={12} />} onClick={onAuthorizeDws} title={t(installAvailable ? 'businessApplications.readiness.authorizeDwsTitle' : 'businessApplications.readiness.runtimeAuthorizationBlocked')}>{t('businessApplications.readiness.authorizeDws')}</Button>
    : readiness.action === 'restart-gateway'
      ? <Button size="xs" variant="outline" tone="warning" loading={busy} onClick={onRestartGateway}>{t('businessApplications.readiness.restartGateway')}</Button>
      : readiness.action === 'refresh'
        ? <Button size="xs" variant="outline" tone="neutral" loading={refreshing} disabled={refreshDisabled} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>{t(refreshing ? 'businessApplications.readiness.refreshing' : 'businessApplications.readiness.refresh')}</Button>
        : null;
  const installationActive = installationProgress.phase === 'checking' || installationProgress.phase === 'installing';
  const installationVisible = installationProgress.phase !== 'idle';
  const installationTone = installationProgress.phase === 'failed'
    ? 'text-aegis-danger'
    : installationProgress.phase === 'completed'
      ? 'text-aegis-success'
      : 'text-aegis-text-secondary';
  const sessionStep: ReadinessStepState = sessionExists ? 'ready' : 'blocked';
  const pluginStep: ReadinessStepState = runtimeToolAvailable
    ? 'ready'
    : restartRequired ? 'pending' : pluginNeedsInstall ? 'blocked' : 'pending';
  const agentStep: ReadinessStepState = runtimeToolAvailable
    ? 'ready'
    : !sessionExists || pluginNeedsInstall || restartRequired ? 'pending' : 'blocked';
  const dwsStep: ReadinessStepState = runtime?.available && runtime.currentProfile && runtime.user
    ? 'ready'
    : runtime?.available ? 'pending' : runtime ? 'blocked' : 'pending';
  const sectionClass = variant === 'workspace'
    ? 'm-3 overflow-hidden rounded-md border'
    : 'mx-3 mt-2 shrink-0 overflow-hidden rounded-md border';
  return (
    <>
      <section className={`${sectionClass} ${toneClass}`} aria-live="polite">
        {gatewayLifecycleActive && (
          <div className="border-b border-aegis-border bg-aegis-bg/75 px-2.5 py-1.5" role="status">
            <div className="flex items-center justify-between gap-2 text-[9.5px] text-aegis-text-secondary">
              <span className="truncate">{gatewayProgress.message}</span>
              <span className="shrink-0 font-mono tabular-nums">{Math.round(Math.max(0, Math.min(1, gatewayProgress.progress)) * 100)}%</span>
            </div>
            <div className="relative mt-1 h-1 overflow-hidden rounded-sm bg-aegis-border/65" role="progressbar" aria-label={gatewayProgress.message} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(1, gatewayProgress.progress)) * 100)}>
              <span className="absolute inset-y-0 left-0 bg-aegis-primary transition-[width] duration-200" style={{ width: `${Math.round(Math.max(0, Math.min(1, gatewayProgress.progress)) * 100)}%` }} />
            </div>
          </div>
        )}
        {operation && !gatewayLifecycleActive && !(operation === 'installing' && installationVisible) && (
          <div
            role="progressbar"
            aria-label={t(operation === 'installing' ? 'businessApplications.readiness.installingPlugin' : operation === 'authorizing' ? 'businessApplications.readiness.authorizingAgent' : 'businessApplications.readiness.restartingGateway')}
            className="relative h-1 overflow-hidden border-b border-aegis-border bg-aegis-bg/75"
          >
            <span className="aegis-indeterminate-progress absolute inset-y-0 w-2/5 bg-aegis-primary" />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 px-2.5 py-2">
          <Icon size={15} className="shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-medium">{title}</p>
            <p className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">{description}</p>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {installationVisible && (
          <div className={variant === 'workspace' ? 'border-t border-current/15 px-4 py-3' : 'mt-2 border-t border-current/15 pt-2'} role="status">
            <div className="flex items-center gap-1.5 text-[9.5px]">
              {installationActive ? <CircleDashed size={12} className="animate-spin" aria-hidden="true" /> : installationProgress.phase === 'completed' ? <CircleCheck size={12} aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
              <span className={installationTone}>{installationProgress.message}</span>
            </div>
            <div className="relative mt-1.5 h-1 overflow-hidden rounded-sm bg-aegis-border/65" role="progressbar" aria-label="钉钉业务插件安装进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installationProgress.phase === 'completed' ? 100 : installationProgress.phase === 'failed' ? 0 : undefined} aria-valuetext={installationProgress.message ?? undefined}>
              {installationActive
                ? <span className="aegis-indeterminate-progress absolute inset-y-0 w-2/5 bg-aegis-primary" />
                : <div className="h-full bg-aegis-primary transition-[width] duration-200" style={{ width: installationProgress.phase === 'completed' ? '100%' : '0%' }} />}
            </div>
          </div>
        )}
        {!installAvailable && (readiness.action === 'install-dws' || readiness.action === 'authorize-dws') && (
          <div className={variant === 'workspace' ? 'border-t border-current/15 px-4 py-3 text-[9.5px] text-aegis-text-dim' : 'mt-2 border-t border-current/15 pt-2 text-[9.5px] text-aegis-text-dim'}>
            {t('businessApplications.readiness.remoteRuntimeGuide')}
            <button type="button" className="ml-1 text-aegis-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={openGuide}>{t('businessApplications.readiness.viewGuide')}</button>
          </div>
        )}
        {variant === 'workspace' && (
          <div className="grid border-t border-aegis-border bg-aegis-bg/70 xl:grid-cols-[minmax(240px,0.85fr)_minmax(280px,1fr)_minmax(230px,0.8fr)]">
            <section className="min-w-0 border-b border-aegis-border p-3 xl:border-b-0 xl:border-r" aria-labelledby="dingtalk-readiness-checks-title">
              <h2 id="dingtalk-readiness-checks-title" className="mb-1 text-[10.5px] font-semibold text-aegis-text-secondary">{t('businessApplications.readiness.accessChecks')}</h2>
              <ReadinessStep label="OpenClaw Session" state={sessionStep} description={t(sessionExists ? 'businessApplications.readiness.sessionBound' : 'businessApplications.readiness.sessionNeeded')} />
              <ReadinessStep label={t('businessApplications.readiness.pluginStep')} state={pluginStep} description={t(runtimeToolAvailable ? 'businessApplications.readiness.pluginToolReady' : pluginNeedsInstall ? 'businessApplications.readiness.pluginInstallNeeded' : restartRequired ? 'businessApplications.readiness.pluginRestartPending' : 'businessApplications.readiness.pluginSessionPending')} />
              <ReadinessStep label={t('businessApplications.readiness.agentStep')} state={agentStep} description={t(runtimeToolAvailable ? 'businessApplications.readiness.agentVerified' : agentId ? 'businessApplications.readiness.agentPending' : 'businessApplications.readiness.agentIdMissing', { agentId })} />
              <ReadinessStep label={t('businessApplications.readiness.dwsIdentityStep')} state={dwsStep} description={t(runtime?.available && runtime.currentProfile && runtime.user ? 'businessApplications.readiness.dwsIdentityReady' : runtime?.available && runtime.currentProfile ? 'businessApplications.readiness.dwsUserPending' : runtime?.available ? 'businessApplications.readiness.dwsAuthorizationNeeded' : runtime ? 'businessApplications.readiness.dwsRuntimeMissing' : 'businessApplications.readiness.dwsStatusPending')} />
            </section>
            <section className="min-w-0 border-b border-aegis-border p-3 xl:border-b-0 xl:border-r" aria-labelledby="dingtalk-current-identity-title">
              <h2 id="dingtalk-current-identity-title" className="mb-2 text-[10.5px] font-semibold text-aegis-text-secondary">{t('businessApplications.readiness.currentIdentity')}</h2>
              <DingTalkRuntimeIdentity runtime={runtime} mode="full" />
            </section>
            <section className="min-w-0 p-3" aria-labelledby="dingtalk-runtime-evidence-title">
              <h2 id="dingtalk-runtime-evidence-title" className="mb-2 text-[10.5px] font-semibold text-aegis-text-secondary">{t('businessApplications.readiness.currentEvidence')}</h2>
              <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-2 border-y border-aegis-border py-3 text-[10px]">
                <dt className="text-aegis-text-dim">Session</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={sessionLabel ?? undefined}>{sessionLabel ?? t('businessApplications.readiness.notSelected')}</dd>
                <dt className="text-aegis-text-dim">Agent</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={agentId ?? undefined}>{agentId ?? t('businessApplications.readiness.notReturned')}</dd>
                <dt className="text-aegis-text-dim">{t('businessApplications.readiness.effectiveTools')}</dt>
                <dd className="font-mono tabular-nums text-aegis-text-secondary">{effectiveToolCount}</dd>
                <dt className="text-aegis-text-dim">{t('businessApplications.readiness.pluginVersion')}</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={pluginVersion ?? undefined}>{pluginVersion ?? t('businessApplications.readiness.notRead')}</dd>
                <dt className="text-aegis-text-dim">{t('businessApplications.readiness.bundledVersion')}</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={bundledPluginVersion ?? undefined}>{bundledPluginVersion ?? t('businessApplications.readiness.notRead')}</dd>
              </dl>
              <p className="mt-3 text-[9.5px] leading-4 text-aegis-text-dim">{t('businessApplications.readiness.evidenceBoundary')}</p>
            </section>
          </div>
        )}
      </section>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="w-[min(620px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="text-[13px]">{t('businessApplications.readiness.installDws')}</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.readiness.guideDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto px-4 py-4">
            <p className="text-[10.5px] font-medium text-aegis-text-secondary">{t('businessApplications.readiness.guideSelect')}</p>
            {DWS_INSTALL_COMMANDS.map(({ label, command }) => (
              <div key={command} className="rounded-md border border-aegis-border bg-aegis-surface/45 p-2">
                <div className="mb-1 text-[10px] text-aegis-text-dim">{label}</div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4 text-aegis-text-secondary">{command}</code>
                  <button type="button" aria-label={t('businessApplications.readiness.copyCommand', { label })} title={t('businessApplications.readiness.copyCommand', { label })} onClick={() => void copyCommand(command)} className="shrink-0 rounded p-1 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"><Copy size={12} /></button>
                </div>
                {copiedCommand === command && <p className="mt-1 text-[9.5px] text-aegis-success">{t('businessApplications.readiness.copied')}</p>}
              </div>
            ))}
            <div className="border-t border-aegis-border pt-3 text-[10.5px] leading-5 text-aegis-text-dim">
              <p>{t('businessApplications.readiness.guideLoginPrefix')} <code className="font-mono text-aegis-text-secondary">dws auth login</code>{t('businessApplications.readiness.guideHeadlessPrefix')} <code className="font-mono text-aegis-text-secondary">dws auth login --device</code>。</p>
              <p className="mt-1">{t('businessApplications.readiness.guideReturn')}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="xs" variant="outline" tone="neutral" leadingIcon={<ExternalLink size={12} />} onClick={() => window.open(DWS_OFFICIAL_GUIDE, '_blank', 'noopener,noreferrer')}>{t('businessApplications.readiness.openOfficialDocs')}</Button>
              <Button size="xs" variant="solid" tone="primary" loading={refreshing} disabled={refreshDisabled} leadingIcon={<RefreshCw size={12} />} onClick={() => { setGuideOpen(false); onRefresh(); }}>{t(refreshing ? 'businessApplications.readiness.refreshing' : 'businessApplications.readiness.refresh')}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={authorizationGuideOpen} onOpenChange={setAuthorizationGuideOpen}>
        <DialogContent className="w-[min(560px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="text-[13px]">{t('businessApplications.readiness.agentDialogTitle')}</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">{t('businessApplications.readiness.agentDialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 py-4">
            <div className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-[10.5px] leading-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-aegis-text-dim">{t('businessApplications.readiness.currentAgent')}</span>
                <code className="font-mono text-aegis-text-secondary">{agentId ?? t('businessApplications.readiness.agentIdNotReturned')}</code>
              </div>
              <p className="mt-2 text-aegis-text-dim">{t('businessApplications.readiness.agentPolicyBoundary')}</p>
            </div>
            <label className="block text-[10.5px] text-aegis-text-secondary" htmlFor="dingtalk-authorization-agent">
              <span className="mb-1.5 block font-medium">{t('businessApplications.readiness.authorizationTarget')}</span>
              <select
                id="dingtalk-authorization-agent"
                value={authorizationTargetAgentId ?? ''}
                onChange={(event) => onAuthorizationTargetAgentChange(event.target.value)}
                disabled={busy || authorizationAgentOptions.length === 0}
                className="h-8 w-full rounded-md border border-aegis-border bg-aegis-bg px-2 font-mono text-[11px] text-aegis-text outline-none transition-colors focus:border-aegis-primary/50 focus-visible:ring-2 focus-visible:ring-aegis-primary/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {authorizationAgentOptions.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name ? `${candidate.name} (${candidate.id})` : candidate.id}
                  </option>
                ))}
              </select>
            </label>
            {authorizationTargetAgentId && authorizationTargetAgentId !== agentId && (
              <p className="rounded-md border border-aegis-warning/25 bg-aegis-warning/[0.05] px-2.5 py-2 text-[10px] leading-5 text-aegis-warning" role="status">
                {t('businessApplications.readiness.nonCurrentAgentVerification', { agentId: authorizationTargetAgentId })}
              </p>
            )}
            <p className="text-[10px] leading-5 text-aegis-text-dim">{t('businessApplications.readiness.currentSession')} <code className="font-mono text-aegis-text-secondary">{sessionLabel ?? t('businessApplications.readiness.notSelected')}</code>。{t('businessApplications.readiness.agentEffectivePrefix')} <code className="font-mono text-aegis-text-secondary">tools.effective</code> {t('businessApplications.readiness.agentEffectiveSuffix')}</p>
          </div>
          <div className="flex justify-end gap-2 border-t border-aegis-border px-4 py-3">
            <Button size="xs" variant="outline" tone="neutral" onClick={() => setAuthorizationGuideOpen(false)}>{t('businessApplications.readiness.close')}</Button>
            <Button size="xs" variant="solid" tone="primary" disabled={!authorizationTargetAgentId} loading={busy && operation === 'authorizing'} onClick={() => { if (!authorizationTargetAgentId) return; setAuthorizationGuideOpen(false); onAuthorizeAgent(authorizationTargetAgentId); }}>{t('businessApplications.readiness.authorizeAndRestart')}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(dwsOperation)} onOpenChange={(open) => { if (!open && !dwsOperationActive) onDismissDws(); }}>
        <DialogContent className="w-[min(720px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="flex items-center gap-2 text-[13px]"><Terminal size={14} />{t(dwsOperation?.kind === 'install' ? 'businessApplications.readiness.installingDws' : 'businessApplications.readiness.authorizingDws')}</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">{dwsOperation?.message ?? t('businessApplications.readiness.waitingDwsOutput')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-4">
            <div className="max-h-64 min-h-28 overflow-auto rounded-md border border-aegis-border bg-aegis-surface/55 p-2 font-mono text-[10px] leading-5 text-aegis-text-secondary" role="log" aria-live="polite" aria-label={t('businessApplications.readiness.dwsOutput')}>
              {dwsOutput.length > 0 ? dwsOutput.map((line, index) => <div key={`${index}-${line}`} className="break-words">{line}</div>) : <span className="text-aegis-text-dim">{t('businessApplications.readiness.waitingOutput')}</span>}
            </div>
            <div className="flex justify-end gap-2">
              {dwsOperationActive ? <Button size="xs" variant="outline" tone="danger" leadingIcon={<Square size={11} />} onClick={onCancelDws}>{t('businessApplications.readiness.cancel')}</Button> : <Button size="xs" variant="solid" tone="primary" loading={refreshing} disabled={refreshDisabled} leadingIcon={<RefreshCw size={12} />} onClick={() => { onRefresh(); onDismissDws(); }}>{t(refreshing ? 'businessApplications.readiness.refreshing' : 'businessApplications.readiness.refresh')}</Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
