export interface CronAgentOptionSource {
  id: string;
  name?: string;
}

export interface CronAgentOption {
  id: string;
  label: string;
  unavailable: boolean;
}

export type CronAgentAvailability = 'loading' | 'error' | 'empty' | 'ready';

export function resolveCronAgentAvailability(
  loading: boolean,
  error: string | null,
  agents: ReadonlyArray<CronAgentOptionSource>,
): CronAgentAvailability {
  if (loading) return 'loading';
  if (error) return 'error';
  return agents.length === 0 ? 'empty' : 'ready';
}

export function buildCronAgentOptions(
  agents: ReadonlyArray<CronAgentOptionSource>,
  currentAgentId: string | null | undefined,
): CronAgentOption[] {
  const options = agents.map((agent) => ({
    id: agent.id,
    label: agent.name || agent.id,
    unavailable: false,
  }));
  const current = currentAgentId?.trim();
  if (current && !agents.some((agent) => agent.id === current)) {
    options.unshift({ id: current, label: current, unavailable: true });
  }
  return options;
}
