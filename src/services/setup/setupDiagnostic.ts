const NAMED_CREDENTIAL = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|credential|private[_-]?key)\b\s*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s|,;}\]]+)/gi;
const AUTHORIZATION_HEADER = /(authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s|,;]+/gi;
const URL_USER_INFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;
const COMMON_SECRET_TOKEN = /\b(?:sk|rk|pk)-[a-z0-9_-]{8,}\b/gi;
const JWT_TOKEN = /\beyJ[a-z0-9_-]{4,}\.[a-z0-9_-]+\.[a-z0-9_-]+\b/gi;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Redact credentials from untrusted provider/Gateway diagnostic text. */
export function sanitizeSetupDiagnostic(value: unknown, maxLength = 2_000): string {
  const boundedLength = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 2_000;
  return String(value ?? '')
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(URL_USER_INFO, '$1[REDACTED]@')
    .replace(AUTHORIZATION_HEADER, '$1[REDACTED]')
    .replace(NAMED_CREDENTIAL, '$1=[REDACTED]')
    .replace(JWT_TOKEN, '[REDACTED]')
    .replace(COMMON_SECRET_TOKEN, '[REDACTED]')
    .slice(0, boundedLength);
}
