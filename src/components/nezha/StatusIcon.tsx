import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Circle,
  Loader2,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import type { TaskStatus } from "../types";

export function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "running":
      return (
        <Loader2
          size={14}
          style={{ animation: "spin 1s linear infinite", color: "rgb(var(--aegis-text-muted))" }}
        />
      );
    case "input_required":
      return <AlertCircle size={14} style={{ color: "rgb(var(--aegis-warning))" }} />;
    case "detached":
      return <AlertTriangle size={14} style={{ color: "rgb(var(--aegis-warning))" }} />;
    case "interrupted":
      return <AlertTriangle size={14} style={{ color: "rgb(var(--aegis-warning))" }} />;
    case "done":
      return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
    case "failed":
      return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    case "cancelled":
      return <MinusCircle size={14} style={{ color: "rgb(var(--aegis-text-dim))" }} />;
    default:
      return <Circle size={14} style={{ color: "rgb(var(--aegis-text-dim))" }} />;
  }
}
