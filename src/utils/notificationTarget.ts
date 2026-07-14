export type NotificationTarget =
  | { kind: 'internal'; value: string }
  | { kind: 'external'; value: string };

export function resolveNotificationTarget(url: string | null | undefined): NotificationTarget | null {
  const value = url?.trim();
  if (!value || value.includes('\0')) return null;

  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
    return { kind: 'internal', value };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { kind: 'external', value: parsed.toString() };
    }
  } catch {
    // Invalid and unsupported targets are intentionally inert.
  }

  return null;
}
