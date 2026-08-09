import { useState } from 'react';
import { CircleAlert, CircleCheck, CircleDashed, Copy, ExternalLink, RefreshCw, Settings2, Square, Terminal, Wrench } from 'lucide-react';
import { Button } from '@/components/shared/button/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

const DWS_OFFICIAL_GUIDE = 'https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli#installation';
const DWS_INSTALL_COMMANDS = [
  { label: 'macOS / Linux', command: 'curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.sh | sh' },
  { label: 'Windows PowerShell', command: 'irm https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-workspace-cli/main/scripts/install.ps1 | iex' },
  { label: 'Node.js / npm', command: 'npm install -g dingtalk-workspace-cli' },
] as const;

type Readiness = {
  readonly tone: 'ready' | 'pending' | 'blocked';
  readonly title: string;
  readonly description: string;
  readonly action: 'refresh' | 'install-plugin' | 'configure-agent' | 'install-dws' | 'authorize-dws' | 'restart-gateway' | null;
};

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

function installationProgressValue(phase: DingTalkPluginInstallProgress['phase']): number {
  if (phase === 'checking') return 25;
  if (phase === 'installing') return 60;
  if (phase === 'completed') return 100;
  return 0;
}

function dwsRuntimeMissing(code: string | null | undefined): boolean {
  return code === 'DWS_RUNTIME_NOT_FOUND' || code === 'DWS_RUNTIME_NOT_EXECUTABLE';
}

function resolveReadiness({
  sessionExists,
  runtimeToolAvailable,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  restartRequired,
  agentId,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  restartRequired: boolean;
  agentId: string | null;
}): Readiness {
  if (!sessionExists) {
    return { tone: 'blocked', title: '需要当前 Session', description: '请选择一个已连接的 OpenClaw Session 后再检测钉钉业务能力。', action: null };
  }
  if (!runtimeToolAvailable) {
    if (pluginNeedsInstall) {
      return { tone: 'blocked', title: '钉钉业务插件未就绪', description: '先安装固定校验的钉钉业务插件，再重启 Gateway 使工具进入当前 Session。', action: 'install-plugin' };
    }
    if (restartRequired) {
      return { tone: 'pending', title: '等待 Gateway 加载插件', description: '插件已更新，重启当前 Gateway 后再读取 DWS 状态。', action: 'restart-gateway' };
    }
    return {
      tone: 'blocked',
      title: '钉钉工具未获当前 Agent 授权',
      description: agentId ? `当前 Agent ${agentId} 尚未通过 OpenClaw 工具策略和钉钉插件 allowedAgentIds 双重授权。` : '当前 Session 未返回可核验的 Agent ID，无法配置授权。',
      action: 'configure-agent',
    };
  }
  if (runtimeError) {
    return { tone: 'pending', title: '正在读取 DWS 状态', description: runtimeError, action: 'refresh' };
  }
  if (!runtime) {
    return { tone: 'pending', title: '正在读取 DWS 状态', description: '等待当前 OpenClaw Session 返回受控 DWS 运行时信息。', action: 'refresh' };
  }
  if (!runtime.available) {
    const error = runtime.runtimeError;
    if (dwsRuntimeMissing(error?.code)) {
      return { tone: 'blocked', title: '当前运行时未安装 DWS', description: '可在已验证的本机或 Docker Gateway 中启动 DWS 官方安装流程；远程 Gateway 需在其宿主环境手动安装。', action: 'install-dws' };
    }
    return { tone: 'blocked', title: 'DWS 运行时不可用', description: error?.message ?? 'DWS 未返回可验证的运行时状态。', action: 'refresh' };
  }
  if (!runtime.currentProfile) {
    return { tone: 'blocked', title: '未确认 DWS 业务身份', description: '在当前 Gateway 运行时启动 DWS 官方设备授权，完成后 JunQi 会重新读取 Profile。', action: 'authorize-dws' };
  }
  if (!runtime.user) {
    return { tone: 'pending', title: '当前用户资料待验证', description: 'DWS 已返回业务身份，当前用户资料尚未完成读取；不会显示猜测的头像或组织信息。', action: 'refresh' };
  }
  return { tone: 'ready', title: 'DWS 业务身份已就绪', description: '当前 Profile、用户资料和授权投影已由 DWS 返回；工具仍受当前 Session 策略约束。', action: 'refresh' };
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
  installationProgress,
  dwsOperation,
  dwsOutput,
  busy,
  onRefresh,
  onInstallPlugin,
  onConfigureAgent,
  onConfigurePlugin,
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
  restartRequired: boolean;
  agentId: string | null;
  installAvailable: boolean;
  installationProgress: DingTalkPluginInstallProgress;
  dwsOperation: DingTalkDwsOperationPresentation | null;
  dwsOutput: readonly string[];
  busy: boolean;
  onRefresh: () => void;
  onInstallPlugin: () => void;
  onConfigureAgent: () => void;
  onConfigurePlugin: () => void;
  onRestartGateway: () => void;
  onInstallDws: () => void;
  onAuthorizeDws: () => void;
  onCancelDws: () => void;
  onDismissDws: () => void;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [authorizationGuideOpen, setAuthorizationGuideOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const readiness = resolveReadiness({ sessionExists, runtimeToolAvailable, runtime, runtimeError, pluginNeedsInstall, restartRequired, agentId });
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
  const action = readiness.action === 'install-plugin'
    ? <Button size="xs" variant="outline" tone="primary" loading={busy} leadingIcon={<Wrench size={12} />} onClick={onInstallPlugin} title={installAvailable ? '在当前已验证的 Gateway 中安装钉钉业务插件' : '需要先连接并验证当前 Gateway'}>在 JunQi 安装</Button>
    : readiness.action === 'configure-agent'
      ? <Button size="xs" variant="outline" tone="warning" leadingIcon={<Settings2 size={12} />} onClick={() => setAuthorizationGuideOpen(true)}>配置授权</Button>
    : readiness.action === 'install-dws'
      ? <Button size="xs" variant="outline" tone="warning" disabled={!installAvailable || dwsOperationActive} loading={dwsOperationActive} leadingIcon={<Terminal size={12} />} onClick={onInstallDws} title={installAvailable ? '在当前已验证的运行时执行 DWS 官方安装命令' : '远程或未验证 Gateway 不允许由桌面修改运行时'}>安装 DWS</Button>
      : readiness.action === 'authorize-dws'
        ? <Button size="xs" variant="outline" tone="primary" disabled={!installAvailable || dwsOperationActive} loading={dwsOperationActive} leadingIcon={<Terminal size={12} />} onClick={onAuthorizeDws} title={installAvailable ? '在当前已验证的运行时启动 DWS 官方设备授权' : '远程或未验证 Gateway 不允许由桌面启动授权'}>授权 DWS</Button>
    : readiness.action === 'restart-gateway'
      ? <Button size="xs" variant="outline" tone="warning" loading={busy} onClick={onRestartGateway}>重启 Gateway</Button>
      : readiness.action === 'refresh'
        ? <Button size="xs" variant="outline" tone="neutral" loading={busy} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>重新检测</Button>
        : null;
  const installationActive = installationProgress.phase === 'checking' || installationProgress.phase === 'installing';
  const installationVisible = installationProgress.phase !== 'idle';
  const installationTone = installationProgress.phase === 'failed'
    ? 'text-aegis-danger'
    : installationProgress.phase === 'completed'
      ? 'text-aegis-success'
      : 'text-aegis-text-secondary';
  return (
    <>
      <section className={`mx-3 mt-2 shrink-0 rounded-md border px-2.5 py-2 ${toneClass}`} aria-live="polite">
        <div className="flex items-center gap-2">
          <Icon size={15} className="shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-medium">{readiness.title}</p>
            <p className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">{readiness.description}</p>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        {installationVisible && (
          <div className="mt-2 border-t border-current/15 pt-2" role="status">
            <div className="flex items-center gap-1.5 text-[9.5px]">
              {installationActive ? <CircleDashed size={12} className="animate-spin" aria-hidden="true" /> : installationProgress.phase === 'completed' ? <CircleCheck size={12} aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}
              <span className={installationTone}>{installationProgress.message}</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-sm bg-aegis-border/65" role="progressbar" aria-label="钉钉业务插件安装进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={installationProgress.phase === 'installing' ? undefined : installationProgressValue(installationProgress.phase)} aria-valuetext={installationProgress.message ?? undefined}>
              <div className={`h-full bg-aegis-primary transition-[width] duration-200 ${installationActive ? 'animate-pulse' : ''}`} style={{ width: `${installationProgressValue(installationProgress.phase)}%` }} />
            </div>
          </div>
        )}
        {!installAvailable && (readiness.action === 'install-dws' || readiness.action === 'authorize-dws') && (
          <div className="mt-2 border-t border-current/15 pt-2 text-[9.5px] text-aegis-text-dim">
            当前 Gateway 不是已验证的本机或 Docker 运行时，请按官方文档在 Gateway 宿主环境完成操作。
            <button type="button" className="ml-1 text-aegis-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={openGuide}>查看指南</button>
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
              <div className="mt-2 flex items-start gap-2 text-aegis-text-dim">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-aegis-warning" aria-hidden="true" />
                <span>插件配置路径：<code className="font-mono text-aegis-text-secondary">plugins.entries.junqi-dingtalk.config.allowedAgentIds</code></span>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-left transition-colors hover:border-aegis-primary/45 hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={onConfigureAgent}>
                <span className="flex items-center gap-2 text-[10.5px] font-medium text-aegis-text"><Settings2 size={13} className="text-aegis-primary" />Agent 工具策略</span>
                <span className="mt-1 block text-[9.5px] leading-4 text-aegis-text-dim">进入 Tools 配置，核对当前 Agent 是否允许钉钉工具。</span>
              </button>
              <button type="button" className="rounded-md border border-aegis-border bg-aegis-surface/45 p-3 text-left transition-colors hover:border-aegis-primary/45 hover:bg-aegis-hover/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary/60" onClick={onConfigurePlugin}>
                <span className="flex items-center gap-2 text-[10.5px] font-medium text-aegis-text"><Wrench size={13} className="text-aegis-primary" />钉钉插件授权名单</span>
                <span className="mt-1 block text-[9.5px] leading-4 text-aegis-text-dim">进入 Advanced 原始配置，设置上方路径并保存。</span>
              </button>
            </div>
            <p className="text-[10px] leading-5 text-aegis-text-dim">保存后回到钉钉工作台，点击“重新检测”。只有当前 Session 的 <code className="font-mono text-aegis-text-secondary">tools.effective</code> 返回钉钉工具时，授权才会显示为有效。</p>
          </div>
          <div className="flex justify-end border-t border-aegis-border px-4 py-3">
            <Button size="xs" variant="outline" tone="neutral" onClick={() => setAuthorizationGuideOpen(false)}>关闭</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(dwsOperation)} onOpenChange={(open) => { if (!open && !dwsOperationActive) onDismissDws(); }}>
        <DialogContent className="w-[min(720px,calc(100vw-24px))] border-aegis-border bg-aegis-bg-solid p-0 text-aegis-text">
          <DialogHeader className="border-b border-aegis-border px-4 py-3 text-left">
            <DialogTitle className="flex items-center gap-2 text-[13px]"><Terminal size={14} />{dwsOperation?.kind === 'install' ? '正在安装 DWS' : '正在进行 DWS 授权'}</DialogTitle>
            <DialogDescription className="text-[10.5px] text-aegis-text-dim">{dwsOperation?.message ?? '正在等待 DWS 官方流程输出。凭据内容不会保留或展示。'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 p-4">
            <div className="max-h-64 min-h-28 overflow-auto rounded-md border border-aegis-border bg-aegis-surface/55 p-2 font-mono text-[10px] leading-5 text-aegis-text-secondary" role="log" aria-live="polite" aria-label="DWS 官方流程输出">
              {dwsOutput.length > 0 ? dwsOutput.map((line, index) => <div key={`${index}-${line}`} className="break-words">{line}</div>) : <span className="text-aegis-text-dim">等待输出...</span>}
            </div>
            <div className="flex justify-end gap-2">
              {dwsOperationActive ? <Button size="xs" variant="outline" tone="danger" leadingIcon={<Square size={11} />} onClick={onCancelDws}>取消</Button> : <Button size="xs" variant="solid" tone="primary" leadingIcon={<RefreshCw size={12} />} onClick={() => { onRefresh(); onDismissDws(); }}>重新检测</Button>}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
