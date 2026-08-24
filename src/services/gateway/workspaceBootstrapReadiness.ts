export interface WorkspaceBootstrapGatewayState {
  connectionStartedAt: number | null;
  lastFetch: {
    sessions: number;
    agents: number;
  };
  loading: {
    sessions: boolean;
    agents: boolean;
  };
  errors: {
    sessions: string | null;
    agents: string | null;
  };
}

function hasCurrentConnectionFetch(
  state: WorkspaceBootstrapGatewayState,
  group: keyof WorkspaceBootstrapGatewayState['lastFetch'],
): boolean {
  return state.connectionStartedAt !== null
    && state.lastFetch[group] >= state.connectionStartedAt;
}

/**
 * 会话快照是工作区首屏唯一的展示数据；但当前数据层先读取智能体范围再读取
 * 会话，所以智能体请求失败时必须结束加载并显示可重试错误。
 */
export function hasCurrentWorkspaceBootstrapData(
  state: WorkspaceBootstrapGatewayState,
): boolean {
  return hasCurrentConnectionFetch(state, 'sessions');
}

/**
 * A settled failed bootstrap keeps the global loading surface actionable.
 * In-flight requests and successful snapshots must continue to render loading
 * and the application respectively.
 */
export function hasCurrentWorkspaceBootstrapFailure(
  state: WorkspaceBootstrapGatewayState,
): boolean {
  if (state.connectionStartedAt === null || hasCurrentWorkspaceBootstrapData(state)) {
    return false;
  }

  if (state.loading.sessions || state.loading.agents) {
    return false;
  }

  return state.errors.sessions !== null || state.errors.agents !== null;
}
