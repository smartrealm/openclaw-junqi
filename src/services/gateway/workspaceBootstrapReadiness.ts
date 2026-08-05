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
 * The dashboard can use shared Gateway data only after both required groups
 * were fetched for the current connection, never from a previous connection.
 */
export function hasCurrentWorkspaceBootstrapData(
  state: WorkspaceBootstrapGatewayState,
): boolean {
  return hasCurrentConnectionFetch(state, 'sessions')
    && hasCurrentConnectionFetch(state, 'agents');
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
