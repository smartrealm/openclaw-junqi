// 状态图标接受现有状态源的并集；未知值使用中性描边圆，避免推断运行时语义。
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

/** 应用实际以图标呈现的状态词汇并集。 */
export type StatusIconValue =
  // 任务与会话的通用状态
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
  // 启动序列状态
  | "completed"
  | "skipped"
  | "error"
  // 会话消息状态
  | "sent"
  | "queued"
  // 工作台状态
  | "queue"
  | "inProgress"
  | "review"
  // 生命周期状态
  | "idle";

interface StatusIconProps {
  status: StatusIconValue;
  size?: number;
}

/**
 * 状态决定图形形状，颜色统一来自共享状态色表；加载图标保留其自身样式。
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

  // 未识别值使用中性播放图标，明确暴露词汇缺口而不是静默伪装成未开始。
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
