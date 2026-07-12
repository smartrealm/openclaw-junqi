// ── StatusIcon — adapted from nezha's StatusIcon ──────────────────────────────
//
// Original nezha typing uses TaskStatus = 'todo' | 'pending' | 'running' |
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
  Loader2,
  AlertCircle,
  AlertTriangle,
  SkipForward,
  PlayCircle,
  Clock,
  Hourglass,
} from "lucide-react";

/**
 * Union of all status strings the app actually renders as an icon.
 * Add new variants here when adopting a new vocabulary; the `default`
 * branch keeps unknown values from blowing up.
 */
export type StatusIconValue =
  // nezha-style TaskStatus
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

export function StatusIcon({ status, size = 14 }: StatusIconProps) {
  switch (status) {
    // ── running / in-progress ──
    case "running":
    case "inProgress":
      return (
        <Loader2
          size={size}
          style={{
            animation: "spin 1s linear infinite",
            color: "rgb(var(--aegis-text-muted))",
          }}
        />
      );

    // ── waiting on user / pending ──
    case "input_required":
      return <AlertCircle size={size} style={{ color: "rgb(var(--aegis-warning))" }} />;
    case "awaiting_review":
      return <Hourglass size={size} style={{ color: "rgb(var(--aegis-warning))" }} />;
    case "pending":
    case "queued":
      return <Clock size={size} style={{ color: "rgb(var(--aegis-text-muted))" }} />;

    // ── detached / interrupted ──
    case "detached":
    case "interrupted":
      return <AlertTriangle size={size} style={{ color: "rgb(var(--aegis-warning))" }} />;

    // ── done / completed / sent ──
    case "done":
    case "completed":
    case "sent":
      return <CheckCircle2 size={size} style={{ color: "var(--success)" }} />;

    // ── failed / error ──
    case "failed":
    case "error":
      return <XCircle size={size} style={{ color: "var(--danger)" }} />;

    // ── cancelled / skipped ──
    case "cancelled":
    case "skipped":
      return <MinusCircle size={size} style={{ color: "rgb(var(--aegis-text-dim))" }} />;

    // ── review ──
    case "review":
      return <Hourglass size={size} style={{ color: "rgb(var(--aegis-primary))" }} />;

    // ── idle (not yet started) ──
    case "idle":
      return <Circle size={size} style={{ color: "rgb(var(--aegis-text-dim))", opacity: 0.4 }} />;

    // ── todo / queue (default) ──
    case "todo":
    case "queue":
    default:
      // Fallback for unknown values: outline circle.
      if (status !== "todo" && status !== "queue") {
        // unknown — render a neutral play icon so it's obvious something
        // is missing rather than silently falling through.
        return <PlayCircle size={size} style={{ color: "rgb(var(--aegis-text-dim))" }} />;
      }
      return <Circle size={size} style={{ color: "rgb(var(--aegis-text-dim))" }} />;
  }
}
