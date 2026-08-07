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
 * 会话快照是工作区首屏唯一必需的 Gateway 数据。智能体列表属于后台投影，
 * 不得因为它的权限、版本或响应失败而阻塞已经可用的会话工作区。
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

  return state.errors.sessions !== null;
}
