const AUTO_ARM_STORAGE_KEY = 'junqi:voice-wake:auto-arm:v1';

interface StoredAutoArmPreference {
  sessionKey: string;
}

const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeAutoArmPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function autoArmSessionKey(): string | null {
  try {
    const raw = localStorage.getItem(AUTO_ARM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const sessionKey = (parsed as StoredAutoArmPreference).sessionKey;
    return typeof sessionKey === 'string' && sessionKey.trim() ? sessionKey : null;
  } catch {
    return null;
  }
}

export function setAutoArmSession(sessionKey: string): void {
  const normalized = sessionKey.trim();
  if (!normalized) return;
  localStorage.setItem(AUTO_ARM_STORAGE_KEY, JSON.stringify({ sessionKey: normalized }));
  publish();
}

export function clearAutoArmSession(): void {
  localStorage.removeItem(AUTO_ARM_STORAGE_KEY);
  publish();
}

export function shouldAutoArmSession(sessionKey: string): boolean {
  return autoArmSessionKey() === sessionKey;
}
