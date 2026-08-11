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
    // 非法或不支持的目标不执行任何动作。
  }

  return null;
}
