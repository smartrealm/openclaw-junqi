// ─────────────────────────────────────────────────────────────────
// Status semantics — the single source of truth for "what state is
// this thing in" and "which theme token paints it".
//
// Before this module the app carried three parallel status vocabularies
// (BUG-FCA-04): `shared/StatusDot` used active|idle|sleeping|error|paused
// with Tailwind classes, `shared/badge` used 15 tones (with duplicate
// spellings like ok/success and err/danger/failed) against
// `--aegis-status-*`, and `shared/StatusBadge` used its own five-value
// lifecycle against the same tokens. Presentation still has three shapes
// (dot, icon, badge) because those are genuinely different UI needs — but
// they now share one semantic domain and one color source.
// ─────────────────────────────────────────────────────────────────

/**
 * The canonical status domain. Deliberately semantic ("what does this
 * mean") rather than chromatic ("what color is it") so themes stay free
 * to repaint, and deliberately free of synonyms so there is exactly one
 * spelling per meaning.
 */
export type StatusTone =
  | 'neutral'
  | 'info'
  | 'idle'
  | 'dormant'
  | 'running'
  | 'attention'
  | 'success'
  | 'warning'
  | 'failed';

/**
 * Vocabularies that reach status presentation from other layers: agent
 * lifecycle, task stores, boot sequence, chat message/tool status, the
 * workshop board, plus the legacy tone spellings that predate this
 * module. Mapping them here is what lets callers keep their own domain
 * language without every component re-deriving a color.
 */
const TONE_ALIASES: Record<string, StatusTone> = {
  // ── canonical values map to themselves
  neutral: 'neutral',
  info: 'info',
  idle: 'idle',
  dormant: 'dormant',
  running: 'running',
  attention: 'attention',
  success: 'success',
  warning: 'warning',
  failed: 'failed',

  // ── legacy tone spellings (shared/badge carried all of these)
  primary: 'info',
  ok: 'success',
  ended: 'success',
  err: 'failed',
  danger: 'failed',
  warn: 'warning',
  live: 'running',

  // ── legacy shared/StatusDot vocabulary
  active: 'running',
  sleeping: 'dormant',
  error: 'failed',
  paused: 'attention',

  // ── task / agent lifecycle
  todo: 'idle',
  pending: 'idle',
  held: 'warning',
  queue: 'idle',
  queued: 'idle',
  inProgress: 'running',
  input_required: 'attention',
  awaiting_review: 'attention',
  // Workshop review is an informational workflow stage. It is distinct from
  // input_required / awaiting_review, which explicitly require attention.
  review: 'info',
  done: 'success',
  completed: 'success',
  interrupted: 'warning',
  // Detached is an abnormal condition, not an absence of one — the previous
  // StatusIcon already painted it amber, and that reading is kept.
  detached: 'warning',
  skipped: 'neutral',
  cancelled: 'neutral',
  blocked: 'attention',
  timed_out: 'warning',
  unknown: 'neutral',
  // A sent message has completed its delivery transition. Keep the historical
  // success meaning used by StatusIcon rather than repainting it as info.
  sent: 'success',
};

/**
 * Normalize any known status vocabulary to the canonical domain.
 * Unknown values resolve to `neutral` rather than throwing: status
 * presentation must never be the reason a screen fails to render.
 */
export function resolveStatusTone(value: string | null | undefined): StatusTone {
  if (!value) return 'neutral';
  return TONE_ALIASES[value] ?? 'neutral';
}

/** True when `value` is already a canonical tone. */
export function isStatusTone(value: unknown): value is StatusTone {
  return typeof value === 'string' && TONE_ALIASES[value] === value;
}

/**
 * Theme token per tone. Every entry is an `--aegis-*` custom property so
 * all four themes repaint status without touching a component.
 */
const TONE_COLOR: Record<StatusTone, string> = {
  neutral: 'rgb(var(--aegis-text-dim))',
  info: 'rgb(var(--aegis-primary))',
  idle: 'rgb(var(--aegis-status-idle))',
  dormant: 'rgb(var(--aegis-status-dormant))',
  running: 'rgb(var(--aegis-status-running))',
  attention: 'rgb(var(--aegis-status-attention))',
  success: 'rgb(var(--aegis-status-ended))',
  warning: 'rgb(var(--aegis-warning))',
  failed: 'rgb(var(--aegis-status-failed))',
};

/** Glow used when a tone is animated as "live". */
const TONE_GLOW: Record<StatusTone, string> = {
  neutral: 'transparent',
  info: 'rgba(var(--aegis-primary) / 0.32)',
  idle: 'var(--aegis-status-idle-surface)',
  dormant: 'transparent',
  running: 'var(--aegis-status-running-glow)',
  attention: 'var(--aegis-status-attention-glow)',
  success: 'var(--aegis-status-running-glow)',
  warning: 'rgba(var(--aegis-warning) / 0.32)',
  failed: 'var(--aegis-status-failed-glow)',
};

export function statusToneColor(tone: StatusTone): string {
  return TONE_COLOR[tone];
}

export function statusToneGlow(tone: StatusTone): string {
  return TONE_GLOW[tone];
}

/**
 * Tones that pulse by default. Only genuinely in-flight work animates:
 * a permanently pulsing dot is noise, and reduced-motion users get a
 * static dot regardless (see the `prefers-reduced-motion` rule in the
 * dot stylesheet).
 */
export function toneAnimatesByDefault(tone: StatusTone): boolean {
  return tone === 'running';
}

/** i18n key + English fallback for each tone. */
const TONE_LABEL: Record<StatusTone, { key: string; fallback: string }> = {
  neutral: { key: 'status.neutral', fallback: 'unknown' },
  info: { key: 'status.info', fallback: 'info' },
  idle: { key: 'status.idle', fallback: 'idle' },
  dormant: { key: 'status.dormant', fallback: 'sleeping' },
  running: { key: 'status.running', fallback: 'running' },
  attention: { key: 'status.attention', fallback: 'needs attention' },
  success: { key: 'status.success', fallback: 'done' },
  warning: { key: 'status.warning', fallback: 'warning' },
  failed: { key: 'status.failed', fallback: 'failed' },
};

export function statusToneLabel(tone: StatusTone): { key: string; fallback: string } {
  return TONE_LABEL[tone];
}

/** Every canonical tone, for tests and exhaustive rendering. */
export const STATUS_TONES: readonly StatusTone[] = [
  'neutral',
  'info',
  'idle',
  'dormant',
  'running',
  'attention',
  'success',
  'warning',
  'failed',
];
