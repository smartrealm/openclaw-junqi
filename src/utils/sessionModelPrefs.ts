const SESSION_MODEL_PREFS_KEY = 'aegis:session-model-prefs';

function readSessionModelPrefs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SESSION_MODEL_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => (
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'string' &&
        entry[1].trim().length > 0
      )),
    );
  } catch {
    return {};
  }
}

export function getSessionModelPref(sessionKey: string): string | null {
  const model = readSessionModelPrefs()[sessionKey];
  return typeof model === 'string' && model.trim().length > 0 ? model : null;
}

export function setSessionModelPref(sessionKey: string, model: string | null): void {
  try {
    const prefs = readSessionModelPrefs();
    if (model && model.trim()) {
      prefs[sessionKey] = model.trim();
    } else {
      delete prefs[sessionKey];
    }
    localStorage.setItem(SESSION_MODEL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore persistence errors
  }
}

export function clearSessionModelPref(sessionKey: string): void {
  setSessionModelPref(sessionKey, null);
}
