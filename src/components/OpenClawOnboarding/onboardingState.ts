import { agentIdFromSessionKey, isIsolatedExecutionSessionKey } from '@/utils/sessionPresentation';

export interface OpenClawOnboardingProgress {
  gatewayReady: boolean;
  providerReady: boolean;
  mainAgentReady: boolean;
  conversationReady: boolean;
  channelReady: boolean;
}

export interface OnboardingSession {
  key: string;
  totalTokens?: number;
  lastMessage?: unknown;
}

const STORAGE_KEY = 'junqi:openclaw-onboarding:v1';

function hasMeaningfulMessage(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(hasMeaningfulMessage);
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return hasMeaningfulMessage(message.content)
    || hasMeaningfulMessage(message.text)
    || hasMeaningfulMessage(message.parts);
}

export function hasOpenClawConversation(session: OnboardingSession | undefined): boolean {
  if (!session) return false;
  return Number(session.totalTokens ?? 0) > 0
    || hasMeaningfulMessage(session.lastMessage);
}

export function hasMainAgent(agents: readonly { id: string }[]): boolean {
  return agents.some((agent) => agent.id === 'main');
}

export function hasMainAgentConversation(sessions: readonly OnboardingSession[]): boolean {
  return sessions.some((session) => (
    agentIdFromSessionKey(session.key) === 'main'
    && !isIsolatedExecutionSessionKey(session.key)
    && hasOpenClawConversation(session)
  ));
}

export function isOpenClawOnboardingComplete(progress: OpenClawOnboardingProgress): boolean {
  return progress.gatewayReady
    && progress.providerReady
    && progress.mainAgentReady
    && progress.conversationReady;
}

export function readOpenClawOnboardingCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

export function setOpenClawOnboardingCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(STORAGE_KEY, 'collapsed');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The guide remains usable when browser storage is unavailable.
  }
}
