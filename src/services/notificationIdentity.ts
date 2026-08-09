export function chatNotificationDedupeKey(
  sessionKey: string,
  role: string,
  runId: string | null | undefined,
): string | undefined {
  const session = sessionKey.trim();
  const identity = runId?.trim() ?? '';
  const normalizedRole = role.trim().toLowerCase();
  if (!session || !identity || !normalizedRole) return undefined;
  return `chat:${normalizedRole}:${session}:${identity}`;
}
