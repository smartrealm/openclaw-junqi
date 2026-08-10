import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

export type DingTalkReadiness = {
  readonly tone: 'ready' | 'pending' | 'blocked';
  readonly title: string;
  readonly description: string;
  readonly action:
    | 'refresh'
    | 'install-plugin'
    | 'restart-gateway'
    | 'configure-agent'
    | 'install-dws'
    | 'authorize-dws'
    | null;
};

function dwsRuntimeMissing(code: string | null | undefined): boolean {
  return code === 'DWS_RUNTIME_NOT_FOUND' || code === 'DWS_RUNTIME_NOT_EXECUTABLE';
}

export function resolveDingTalkReadiness({
  sessionExists,
  runtimeToolAvailable,
  runtime,
  runtimeError,
  pluginNeedsInstall,
  pluginStatusPending,
  restartRequired,
  agentId,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  pluginStatusPending: boolean;
  restartRequired: boolean;
  agentId: string | null;
}): DingTalkReadiness {
  if (!sessionExists) {
    return { tone: 'blocked', title: '需要当前 Session', description: '请选择一个已连接的 OpenClaw Session 后再检测钉钉业务能力。', action: null };
  }
  if (!runtimeToolAvailable) {
    if (restartRequired) {
      return { tone: 'pending', title: '等待 Gateway 加载插件', description: '插件已更新，重启当前 Gateway 后再读取 DWS 状态。', action: 'restart-gateway' };
    }
    if (pluginStatusPending) {
      return { tone: 'pending', title: '正在核对钉钉接入状态', description: '正在同时读取当前 Session 工具和已安装插件状态。', action: null };
    }
    if (pluginNeedsInstall) {
      return { tone: 'blocked', title: '钉钉业务插件未就绪', description: '先安装固定校验的钉钉业务插件，再重启 Gateway 使工具进入当前 Session。', action: 'install-plugin' };
    }
    return {
      tone: 'blocked',
      title: '钉钉工具未获当前 Agent 授权',
      description: agentId
        ? `当前 Agent ${agentId} 尚未通过 OpenClaw 工具策略和钉钉插件 allowedAgentIds 双重授权。`
        : '当前 Session 未返回可核验的 Agent ID，无法配置授权。',
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
      return {
        tone: 'blocked',
        title: '当前运行时未安装 DWS',
        description: '可在已验证的本机或 Docker Gateway 中启动 DWS 官方安装流程；远程 Gateway 需在其宿主环境手动安装。',
        action: 'install-dws',
      };
    }
    return { tone: 'blocked', title: 'DWS 运行时不可用', description: error?.message ?? 'DWS 未返回可验证的运行时状态。', action: 'refresh' };
  }
  if (!runtime.currentProfile) {
    return {
      tone: 'blocked',
      title: '未确认 DWS 业务身份',
      description: '启动 DWS 官方授权。本机将打开浏览器扫码，Docker 或无界面运行时显示设备码；完成后 JunQi 会自动重新读取 Profile。',
      action: 'authorize-dws',
    };
  }
  if (!runtime.user) {
    return { tone: 'pending', title: '当前用户资料待验证', description: 'DWS 已返回业务身份，当前用户资料尚未完成读取；不会显示猜测的头像或组织信息。', action: 'refresh' };
  }
  return { tone: 'ready', title: 'DWS 业务身份已就绪', description: '当前 Profile、用户资料和授权投影已由 DWS 返回；工具仍受当前 Session 策略约束。', action: 'refresh' };
}
