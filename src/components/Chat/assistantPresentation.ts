import type { OpenClawAgentIdentity } from '@/services/gateway/OpenClawAgentIdentityClient';

export interface AssistantPresentation {
  readonly name: string;
  readonly letter: string;
  readonly marker?: string;
}

/** Keeps assistant labels authoritative when a session identity is available. */
export function resolveAssistantPresentation(
  identity: OpenClawAgentIdentity | null,
  genericAssistantName: string,
): AssistantPresentation {
  const name = identity?.name ?? genericAssistantName;
  return {
    name,
    letter: name.charAt(0) || genericAssistantName.charAt(0),
    ...(identity?.emoji ? { marker: identity.emoji } : {}),
  };
}
