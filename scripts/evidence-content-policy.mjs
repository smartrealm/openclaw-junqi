/**
 * Content policy shared by evidence producers and the release validator.
 * Patterns intentionally target high-confidence credential formats; the
 * policy never includes matched bytes in an error or log message.
 */
export const SCANNED_EVIDENCE_KINDS = Object.freeze(new Set([
  'LOG',
  'METRICS',
  'OBSERVATION',
  'INTERACTION_TRACE',
]));

const FORBIDDEN_SECRET_PATTERNS = Object.freeze([
  Object.freeze({ code: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ }),
  Object.freeze({ code: 'BEARER_TOKEN', pattern: /\b(?:authorization|proxy-authorization)\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]{16,}/i }),
  Object.freeze({ code: 'GITHUB_TOKEN', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ }),
  Object.freeze({ code: 'AWS_ACCESS_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/ }),
  Object.freeze({ code: 'SLACK_TOKEN', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ }),
  Object.freeze({ code: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ }),
  Object.freeze({ code: 'GENERIC_SECRET_ASSIGNMENT', pattern: /\b(?:api[_-]?key|access[_-]?token|password|secret|token)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{20,}/i }),
]);

export const MAX_CONTENT_SCAN_TAIL_CHARS = 4096;
export const MAX_EVIDENCE_BYTES = 1024 * 1024;
// Keep the pre-upload scanner bounded even when a producer is compromised.
// These limits are deliberately shared with the physical artifact validator.
export const MAX_EVIDENCE_ARTIFACT_ENTRIES = 1024;
export const MAX_EVIDENCE_ARTIFACT_DEPTH = 32;
export const MAX_EVIDENCE_ARTIFACT_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

export function forbiddenSecretCode(text) {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  return FORBIDDEN_SECRET_PATTERNS.find(({ pattern }) => pattern.test(text))?.code;
}

export function shouldScanEvidenceKind(kind) {
  return SCANNED_EVIDENCE_KINDS.has(kind);
}

export function scanTextChunk(previousTail, chunk) {
  const text = `${previousTail ?? ''}${chunk ?? ''}`;
  const code = forbiddenSecretCode(text);
  return {
    code,
    tail: text.slice(-MAX_CONTENT_SCAN_TAIL_CHARS),
  };
}
