import { useState } from 'react';
import { CircleAlert, CircleCheck, Copy, ExternalLink, RefreshCw, Wrench } from 'lucide-react';
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
  readonly action: 'refresh' | 'install-plugin' | 'restart-gateway' | null;
};

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
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  restartRequired: boolean;
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
    return { tone: 'blocked', title: '钉钉工具未获当前 Agent 授权', description: '请同时核对 OpenClaw 的 Agent 工具策略和插件 allowedAgentIds，然后重新检测。', action: 'refresh' };
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
      return { tone: 'blocked', title: '当前运行时未安装 DWS', description: '请在当前 Gateway 运行时按 DWS 官方安装流程完成安装；JunQi 不会自动修改主机环境。', action: 'refresh' };
    }
    return { tone: 'blocked', title: 'DWS 运行时不可用', description: error?.message ?? 'DWS 未返回可验证的运行时状态。', action: 'refresh' };
  }
  if (!runtime.currentProfile) {
    return { tone: 'blocked', title: '未确认 DWS 业务身份', description: '请在 DWS 官方登录与授权流程中完成业务身份选择，然后重新检测。', action: 'refresh' };
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
  installAvailable,
  busy,
  onRefresh,
  onInstallPlugin,
  onRestartGateway,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  restartRequired: boolean;
  installAvailable: boolean;
  busy: boolean;
  onRefresh: () => void;
  onInstallPlugin: () => void;
  onRestartGateway: () => void;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const readiness = resolveReadiness({ sessionExists, runtimeToolAvailable, runtime, runtimeError, pluginNeedsInstall, restartRequired });
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
  const action = readiness.title === '当前运行时未安装 DWS'
    ? <Button size="xs" variant="outline" tone="warning" onClick={openGuide} leadingIcon={<ExternalLink size={12} />}>安装指南</Button>
    : readiness.action === 'install-plugin' && installAvailable
    ? <Button size="xs" variant="outline" tone="primary" loading={busy} leadingIcon={<Wrench size={12} />} onClick={onInstallPlugin}>安装插件</Button>
    : readiness.action === 'restart-gateway'
      ? <Button size="xs" variant="outline" tone="warning" loading={busy} onClick={onRestartGateway}>重启 Gateway</Button>
      : readiness.action === 'refresh'
        ? <Button size="xs" variant="outline" tone="neutral" loading={busy} leadingIcon={<RefreshCw size={12} />} onClick={onRefresh}>重新检测</Button>
        : null;
  return (
    <>
      <section className={`mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-2 ${toneClass}`} aria-live="polite">
        <Icon size={15} className="shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-medium">{readiness.title}</p>
          <p className="mt-0.5 text-[9.5px] leading-4 text-aegis-text-dim">{readiness.description}</p>
        </div>
        {action && <div className="shrink-0">{action}</div>}
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
    </>
  );
}
