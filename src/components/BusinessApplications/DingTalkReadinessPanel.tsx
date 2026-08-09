import { useState } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, Copy, ExternalLink, RefreshCw, Settings2, Wrench } from 'lucide-react';
import { Button } from '@/components/shared/button/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';
import { DingTalkRuntimeIdentity } from './DingTalkRuntimeIdentity';
import { resolveDingTalkReadiness } from './dingTalkReadiness';

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
  const Icon = state === 'ready' ? CircleCheck : state === 'blocked' ? CircleAlert : CircleDashed;
  const stateLabel = state === 'ready' ? '已核验' : state === 'blocked' ? '需处理' : '待核验';
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

export function DingTalkReadinessPanel({
  sessionExists,
  runtimeToolAvailable,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  restartRequired,
  agentId,
  installAvailable,
  busy,
  operation,
  sessionLabel,
  effectiveToolCount,
  pluginVersion,
  bundledPluginVersion,
  onRefresh,
  onInstallPlugin,
  onConfigureAgent,
  onConfigurePlugin,
  onRestartGateway,
  variant = 'banner',
  hideWhenReady = false,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  restartRequired: boolean;
  agentId: string | null;
  installAvailable: boolean;
  busy: boolean;
  operation: 'installing' | 'restarting' | null;
  sessionLabel: string | null;
  effectiveToolCount: number;
  pluginVersion: string | null;
  bundledPluginVersion: string | null;
  onRefresh: () => void;
  onInstallPlugin: () => void;
  onConfigureAgent: () => void;
  onConfigurePlugin: () => void;
  onRestartGateway: () => void;
  variant?: 'banner' | 'workspace';
  hideWhenReady?: boolean;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [authorizationGuideOpen, setAuthorizationGuideOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const readiness = resolveDingTalkReadiness({ sessionExists, runtimeToolAvailable, runtime, runtimeError, pluginNeedsInstall, restartRequired });
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
  if (hideWhenReady && readiness.tone === 'ready') return null;
  const description = readiness.action === 'install-plugin' && !installAvailable
    ? '当前 Gateway 尚未提供可验证的桌面安装边界。请先确认已连接并验证由 JunQi 管理的本机 Native 或 Docker Runtime，再重新检测。'
    : readiness.description;
  const action = readiness.title === '当前运行时未安装 DWS'
    ? <Button size="xs" variant="outline" tone="warning" onClick={openGuide} leadingIcon={<ExternalLink size={12} />}>安装指南</Button>
    : readiness.action === 'install-plugin'
      ? installAvailable
        ? <Button size="xs" variant="outline" tone="primary" loading={busy} leadingIcon={<Wrench size={12} />} onClick={onInstallPlugin} title="在当前已验证的 Gateway 中安装钉钉业务插件">在 JunQi 安装</Button>
        : <Button size="xs" variant="outline" tone="neutral" loading={busy} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>重新检测</Button>
    : readiness.action === 'restart-gateway'
      ? <Button size="xs" variant="outline" tone="warning" loading={busy} onClick={onRestartGateway}>重启 Gateway</Button>
      : readiness.action === 'configure-agent'
        ? <Button size="xs" variant="outline" tone="warning" leadingIcon={<Settings2 size={12} />} onClick={() => setAuthorizationGuideOpen(true)}>配置授权</Button>
      : readiness.action === 'refresh'
        ? <Button size="xs" variant="outline" tone="neutral" loading={busy} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>重新检测</Button>
        : null;
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
    : 'mx-3 mt-2 rounded-md border';
  return (
    <>
      <section className={`${sectionClass} ${toneClass}`} aria-live="polite">
        {operation && (
          <div
            role="progressbar"
            aria-label={operation === 'installing' ? '正在安装钉钉业务插件' : '正在重启 Gateway'}
            className="relative h-1 overflow-hidden border-b border-aegis-border bg-aegis-bg/75"
          >
            <span className="aegis-indeterminate-progress absolute inset-y-0 w-2/5 bg-aegis-primary" />
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 px-2.5 py-2">
          <Icon size={15} className="shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-medium">{readiness.title}</p>
            <p className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">{description}</p>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {variant === 'workspace' && (
          <div className="grid border-t border-aegis-border bg-aegis-bg/70 xl:grid-cols-[minmax(240px,0.85fr)_minmax(280px,1fr)_minmax(230px,0.8fr)]">
            <section className="min-w-0 border-b border-aegis-border p-3 xl:border-b-0 xl:border-r" aria-labelledby="dingtalk-readiness-checks-title">
              <h2 id="dingtalk-readiness-checks-title" className="mb-1 text-[10.5px] font-semibold text-aegis-text-secondary">接入检查</h2>
              <ReadinessStep label="OpenClaw Session" state={sessionStep} description={sessionExists ? '当前业务视图已绑定真实 Session。' : '需要选择已连接的 OpenClaw Session。'} />
              <ReadinessStep label="钉钉业务插件" state={pluginStep} description={runtimeToolAvailable ? '当前 Session 已返回插件运行时工具。' : pluginNeedsInstall ? '需要安装或更新固定校验的插件包。' : restartRequired ? '插件已更新，等待 Gateway 重启加载。' : '插件状态已读取，仍待 Gateway 会话核验。'} />
              <ReadinessStep label="Agent 授权" state={agentStep} description={runtimeToolAvailable ? '当前 Agent 已通过有效工具投影核验。' : agentId ? `当前 Agent ${agentId} 的工具策略和插件授权名单待确认。` : 'Gateway 尚未返回可核验的 Agent ID。'} />
              <ReadinessStep label="DWS 身份" state={dwsStep} description={runtime?.available && runtime.currentProfile && runtime.user ? '当前 Profile、用户资料和授权投影已读取。' : runtime?.available && runtime.currentProfile ? 'Profile 已读取，用户资料仍待核验。' : runtime?.available ? 'DWS 已安装，仍需完成官方授权。' : runtime ? '当前运行时未提供可用 DWS。' : '等待当前 Session 返回 DWS 状态。'} />
            </section>
            <section className="min-w-0 border-b border-aegis-border p-3 xl:border-b-0 xl:border-r" aria-labelledby="dingtalk-current-identity-title">
              <h2 id="dingtalk-current-identity-title" className="mb-2 text-[10.5px] font-semibold text-aegis-text-secondary">当前业务身份</h2>
              <DingTalkRuntimeIdentity runtime={runtime} mode="full" />
            </section>
            <section className="min-w-0 p-3" aria-labelledby="dingtalk-runtime-evidence-title">
              <h2 id="dingtalk-runtime-evidence-title" className="mb-2 text-[10.5px] font-semibold text-aegis-text-secondary">当前核验证据</h2>
              <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-2 border-y border-aegis-border py-3 text-[10px]">
                <dt className="text-aegis-text-dim">Session</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={sessionLabel ?? undefined}>{sessionLabel ?? '未选择'}</dd>
                <dt className="text-aegis-text-dim">Agent</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={agentId ?? undefined}>{agentId ?? '未返回'}</dd>
                <dt className="text-aegis-text-dim">有效工具</dt>
                <dd className="font-mono tabular-nums text-aegis-text-secondary">{effectiveToolCount}</dd>
                <dt className="text-aegis-text-dim">插件版本</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={pluginVersion ?? undefined}>{pluginVersion ?? '未读取'}</dd>
                <dt className="text-aegis-text-dim">内置版本</dt>
                <dd className="truncate font-mono text-aegis-text-secondary" title={bundledPluginVersion ?? undefined}>{bundledPluginVersion ?? '未读取'}</dd>
              </dl>
              <p className="mt-3 text-[9.5px] leading-4 text-aegis-text-dim">这里仅展示当前 Gateway、Session 和 DWS 返回的结构化投影。插件已安装、Gateway 健康或本地按钮完成均不代表钉钉业务操作成功。</p>
            </section>
          </div>
        )}
      </section>
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="w-[min(620px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="text-[13px]">安装 DWS</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">请在当前 OpenClaw Gateway 所在机器或容器中完成安装。JunQi 不会替你执行远程安装脚本。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto px-4 py-4">
            <p className="text-[10.5px] font-medium text-aegis-text-secondary">选择与 Gateway 运行环境对应的入口</p>
            {DWS_INSTALL_COMMANDS.map(({ label, command }) => (
              <div key={command} className="rounded-md border border-aegis-border bg-aegis-surface/45 p-2">
                <div className="mb-1 text-[10px] text-aegis-text-dim">{label}</div>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-4 text-aegis-text-secondary">{command}</code>
                  <button type="button" aria-label={`复制 ${label} 安装命令`} title={`复制 ${label} 安装命令`} onClick={() => void copyCommand(command)} className="shrink-0 rounded p-1 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60"><Copy size={12} /></button>
                </div>
                {copiedCommand === command && <p className="mt-1 text-[9.5px] text-aegis-success">已复制</p>}
              </div>
            ))}
            <div className="border-t border-aegis-border pt-3 text-[10.5px] leading-5 text-aegis-text-dim">
              <p>安装后，在同一 Gateway 环境完成登录：<code className="font-mono text-aegis-text-secondary">dws auth login</code>；无图形界面时使用 <code className="font-mono text-aegis-text-secondary">dws auth login --device</code>。</p>
              <p className="mt-1">授权完成后回到 JunQi，点击“重新检测”。JunQi 只会展示 DWS 返回的 Profile、用户与授权域。</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="xs" variant="outline" tone="neutral" leadingIcon={<ExternalLink size={12} />} onClick={() => window.open(DWS_OFFICIAL_GUIDE, '_blank', 'noopener,noreferrer')}>打开官方文档</Button>
              <Button size="xs" variant="solid" tone="primary" leadingIcon={<RefreshCw size={12} />} onClick={() => { setGuideOpen(false); onRefresh(); }}>重新检测</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={authorizationGuideOpen} onOpenChange={setAuthorizationGuideOpen}>
        <DialogContent className="w-[min(560px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="text-[13px]">配置钉钉 Agent 授权</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">钉钉业务工具需要同时通过 OpenClaw 的 Agent 工具策略和插件授权名单，任一缺失都会保持阻断。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 py-4">
            <div className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-[10.5px] leading-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-aegis-text-dim">当前 Agent</span>
                <code className="font-mono text-aegis-text-secondary">{agentId ?? '未返回 Agent ID'}</code>
              </div>
              <div className="mt-2 text-aegis-text-dim">插件配置路径：<code className="font-mono text-aegis-text-secondary">plugins.entries.junqi-dingtalk.config.allowedAgentIds</code></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-left transition-colors hover:border-aegis-primary/45 hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={onConfigureAgent}>
                <span className="flex items-center gap-2 text-[10.5px] font-medium text-aegis-text"><Settings2 size={13} className="text-aegis-primary" />Agent 工具策略</span>
                <span className="mt-1 block text-[9.5px] leading-4 text-aegis-text-dim">进入工具配置，核对当前 Agent 是否允许钉钉工具。</span>
              </button>
              <button type="button" className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-left transition-colors hover:border-aegis-primary/45 hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={onConfigurePlugin}>
                <span className="flex items-center gap-2 text-[10.5px] font-medium text-aegis-text"><Wrench size={13} className="text-aegis-primary" />插件授权名单</span>
                <span className="mt-1 block text-[9.5px] leading-4 text-aegis-text-dim">进入高级配置，设置上方路径并保存。</span>
              </button>
            </div>
            <p className="text-[10px] leading-5 text-aegis-text-dim">保存后回到钉钉工作台重新检测。只有当前 Session 的 <code className="font-mono text-aegis-text-secondary">tools.effective</code> 返回钉钉工具时，授权才会显示为有效。</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
