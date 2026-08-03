// ── StatusIcon — adapted from junqi's StatusIcon ──────────────────────────────
//
// Original junqi typing uses TaskStatus = 'todo' | 'pending' | 'running' |
// 'input_required' | 'detached' | 'interrupted' | 'done' | 'failed' | 'cancelled'.
//
// Junqi's existing stores use overlapping but distinct vocabularies:
//   - bootSequenceStore: 'pending' | 'running' | 'completed' | 'skipped' | 'error'
//   - chatStore toolStatus: 'running' | 'done' | 'error'
//   - chatStore message.status: 'sent' | 'queued' | 'cancelled'
//   - workshopStore: 'queue' | 'inProgress' | 'review' | 'done'
//
// To keep one icon set for all of them, this component accepts a union of
// known statuses from every layer. Unrecognized statuses fall through to a
// neutral outlined circle.
//
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Circle,
  AlertCircle,
  AlertTriangle,
  PlayCircle,
  Clock,
  Hourglass,
  type LucideIcon,
} from "lucide-react";
import { LoadingIndicator } from "./LoadingIndicator";
import { resolveStatusTone, statusToneColor } from "./status/statusTone";

/**
 * Union of all status strings the app actually renders as an icon.
 * Add new variants here when adopting a new vocabulary; the `default`
 * branch keeps unknown values from blowing up.
 */
export type StatusIconValue =
  // junqi-style TaskStatus
  | "todo"
  | "pending"
  | "running"
  | "input_required"
  | "awaiting_review"
  | "detached"
  | "interrupted"
  | "done"
  | "failed"
  | "cancelled"
  | "blocked"
  | "timed_out"
  | "unknown"
  // bootSequenceStore
  | "completed"
  | "skipped"
  | "error"
  // chatStore.message.status
  | "sent"
  | "queued"
  // workshopStore
  | "queue"
  | "inProgress"
  | "review"
  // AgentRunView / agent lifecycle
  | "idle";

interface StatusIconProps {
  status: StatusIconValue;
  size?: number;
}

/**
 * Glyph per status. Shape is the status's own concern — an hourglass and a
 * cross mean different things at a glance — but color is not: it comes from
 * the shared tone table so the same meaning is painted the same way in every
 * presentation shape (BUG-FCA-04).
 *
 * `spinner` is special-cased: `LoadingIndicator` carries its own styling.
 */
const STATUS_GLYPH: Record<StatusIconValue, LucideIcon | "spinner"> = {
  running: "spinner",
  inProgress: "spinner",

  input_required: AlertCircle,
  awaiting_review: Hourglass,
  review: Hourglass,

  pending: Clock,
  queued: Clock,

  detached: AlertTriangle,
  interrupted: AlertTriangle,

  done: CheckCircle2,
  completed: CheckCircle2,
  sent: CheckCircle2,

  failed: XCircle,
  error: XCircle,

  cancelled: MinusCircle,
  blocked: AlertTriangle,
  timed_out: Hourglass,
  unknown: Circle,
  skipped: MinusCircle,

  idle: Circle,
  todo: Circle,
  queue: Circle,
};

export function StatusIcon({ status, size = 14 }: StatusIconProps) {
  const glyph = STATUS_GLYPH[status];

  // Unknown value: a neutral play icon makes the gap visible instead of
  // silently rendering as "not started".
  if (!glyph) {
    return <PlayCircle size={size} style={{ color: statusToneColor("neutral") }} />;
  }

  const color = statusToneColor(resolveStatusTone(status));

  if (glyph === "spinner") {
    return <LoadingIndicator size={size} style={{ color }} />;
  }

  const Glyph = glyph;

  return (
    <Glyph
      size={size}
      style={{ color, ...(status === "idle" ? { opacity: 0.4 } : null) }}
    />
  );
}
