export function chatNotificationDedupeKey(
  sessionKey: string,
  role: string,
  messageIdentity: string | number | undefined,
): string | undefined {
  const session = sessionKey.trim();
  const identity = String(messageIdentity ?? '').trim();
  const normalizedRole = role.trim().toLowerCase();
  if (!session || !identity || !normalizedRole) return undefined;
  return `chat:${normalizedRole}:${session}:${identity}`;
}

export interface GatewayChatNotificationIdentity {
  sessionKey: string;
  role: string;
  runId?: string | null;
  clientMessageId?: string | null;
  nativeMessageId?: string | null;
  messageSeq?: number | null;
}

function firstUsableIdentity(
  identities: ReadonlyArray<string | number | null | undefined>,
): string | number | undefined {
  for (const identity of identities) {
    if (identity !== null && identity !== undefined && String(identity).trim().length > 0) {
      return identity;
    }
  }
  return undefined;
}

/**
 * One OpenClaw reply can have both a live-stream and durable-transcript
 * projection. The run id is the shared identity for that pair; message ids
 * are only fallbacks for transcript-only or legacy events.
 */
export function gatewayChatNotificationDedupeKey(
  identity: GatewayChatNotificationIdentity,
): string | undefined {
  return chatNotificationDedupeKey(
    identity.sessionKey,
    identity.role,
    firstUsableIdentity([
      identity.runId,
      identity.clientMessageId,
      identity.nativeMessageId,
      identity.messageSeq,
    ]),
  );
}
