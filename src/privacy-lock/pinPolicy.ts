export function normalizeJunQiPin(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function isValidJunQiPin(value: string): boolean {
  return /^\d{4,6}$/.test(value);
}
