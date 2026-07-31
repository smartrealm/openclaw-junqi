import type { Session } from '@/stores/chatStore';

export type SessionChannelIconKind = 'generic';

export type SessionChannelSource = 'channel' | 'lastChannel' | 'originProvider' | 'originSurface';

export interface SessionChannelPresentation {
  readonly id: string;
  readonly source: SessionChannelSource;
  readonly icon: SessionChannelIconKind;
  readonly label: string;
}

function normalizedChannelId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function channelDisplayLabel(channelId: string): string {
  return channelId
    .split(/[-_.:/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Projects only structured Gateway session source fields. It intentionally
 * does not infer a channel from the session key, title, or local configuration.
 */
export function resolveSessionChannelPresentation(
  session: Pick<Session, 'channel' | 'lastChannel' | 'origin'>,
): SessionChannelPresentation | null {
  const candidates: ReadonlyArray<readonly [unknown, SessionChannelSource]> = [
    [session.channel, 'channel'],
    [session.lastChannel, 'lastChannel'],
    [session.origin?.provider, 'originProvider'],
    [session.origin?.surface, 'originSurface'],
  ];

  for (const [candidate, source] of candidates) {
    const id = normalizedChannelId(candidate);
    if (!id) continue;
    return {
      id,
      source,
      icon: 'generic',
      label: channelDisplayLabel(id),
    };
  }

  return null;
}
