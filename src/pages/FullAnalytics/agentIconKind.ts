export type AgentIconKind = 'bot' | 'search' | 'box' | 'brain' | 'target' | 'chart' | 'tool' | 'launch' | 'idea';

const AGENT_ICON_KINDS: readonly AgentIconKind[] = [
  'bot',
  'search',
  'box',
  'brain',
  'target',
  'chart',
  'tool',
  'launch',
  'idea',
];

export function getAgentIconKind(agentId: string): AgentIconKind {
  if (agentId === 'main') return 'bot';
  let hash = 0;
  for (let index = 0; index < agentId.length; index += 1) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(index)) | 0;
  }
  return AGENT_ICON_KINDS[Math.abs(hash) % AGENT_ICON_KINDS.length];
}
