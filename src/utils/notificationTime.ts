const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function roundedRelativeValue(delta: number, unit: number): number {
  const value = Math.round(delta / unit);
  return Object.is(value, -0) ? 0 : value;
}

export function formatNotificationTime(
  iso: string,
  locale: string,
  now = Date.now(),
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';

  const delta = timestamp - now;
  const absoluteDelta = Math.abs(delta);
  try {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (absoluteDelta < MINUTE) {
      return relative.format(roundedRelativeValue(delta, SECOND), 'second');
    }
    if (absoluteDelta < HOUR) {
      return relative.format(roundedRelativeValue(delta, MINUTE), 'minute');
    }
    if (absoluteDelta < DAY) {
      return relative.format(roundedRelativeValue(delta, HOUR), 'hour');
    }
    if (absoluteDelta < 7 * DAY) {
      return relative.format(roundedRelativeValue(delta, DAY), 'day');
    }

    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp);
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}
