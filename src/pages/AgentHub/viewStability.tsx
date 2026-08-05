import type { ReactNode } from "react";

export function hasAgentHubSnapshot(lastFetch: { sessions: number; agents: number }): boolean {
  return lastFetch.sessions > 0 && lastFetch.agents > 0;
}

export function shouldShowAgentHubInitialLoading(loading: boolean, hydrated: boolean): boolean {
  return loading && !hydrated;
}

export function AgentHubViewPanel({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div hidden={!active} aria-hidden={active ? undefined : true}>
      {children}
    </div>
  );
}
