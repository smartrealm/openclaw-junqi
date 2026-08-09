import type { DingTalkRuntimeIdentityProjection } from '@/business-applications/dingtalkTools';

export type DingTalkReadiness = {
  readonly tone: 'ready' | 'pending' | 'blocked';
  readonly title: string;
  readonly description: string;
  readonly action: 'refresh' | 'install-plugin' | 'restart-gateway' | 'configure-agent' | null;
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
  restartRequired,
}: {
  sessionExists: boolean;
  runtimeToolAvailable: boolean;
  runtime: DingTalkRuntimeIdentityProjection | null;
  runtimeError: string | null;
  pluginNeedsInstall: boolean;
  restartRequired: boolean;
}): DingTalkReadiness {
  if (!sessionExists) {
    return { tone: 'blocked', title: '需要当前 Session', description: '请选择一个已连接的 OpenClaw Session 后再检测钉钉业务能力。', action: null };
  }
  if (!runtimeToolAvailable) {
    if (restartRequired) {
      return { tone: 'pending', title: '等待 Gateway 加载插件', description: '插件已更新，重启当前 Gateway 后再读取 DWS 状态。', action: 'restart-gateway' };
    }
    if (pluginNeedsInstall) {
      return { tone: 'blocked', title: '钉钉业务插件未就绪', description: '先安装固定校验的钉钉业务插件，再重启 Gateway 使工具进入当前 Session。', action: 'install-plugin' };
    }
    return { tone: 'blocked', title: '钉钉工具未获当前 Agent 授权', description: '请同时核对 OpenClaw 的 Agent 工具策略和插件 allowedAgentIds，然后重新检测。', action: 'configure-agent' };
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
