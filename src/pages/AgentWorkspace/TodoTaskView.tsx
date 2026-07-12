import { Pencil, Play } from "lucide-react";
import type { AgentWorkspaceTask } from "@/stores/agentWorkspaceStore";

const PERMISSION_LABEL: Record<AgentWorkspaceTask["permissionMode"], string> = {
  ask: "询问权限",
  auto_edit: "自动编辑",
  full_access: "完全访问",
};

export function AgentWorkspaceTodoTaskView({
  task,
  onEdit,
  onRun,
}: {
  task: AgentWorkspaceTask;
  onEdit: () => void;
  onRun: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center px-12">
      <section className="flex w-full max-w-[700px] flex-col gap-4 rounded-lg border border-aegis-border bg-aegis-card p-6 shadow-sm">
        <header className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase text-aegis-text-dim">待办任务</span>
          <button type="button" title="编辑任务" onClick={onEdit} className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">
            <Pencil size={13} />
          </button>
        </header>
        <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-aegis-text">
          {task.prompt}
        </div>
        <footer className="flex flex-wrap items-center gap-2 text-xs text-aegis-text-dim">
          <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">{task.agent === "codex" ? "Codex" : "Claude Code"}</span>
          <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">{PERMISSION_LABEL[task.permissionMode]}</span>
          {task.launchMode === "worktree" && <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">工作树</span>}
          <button type="button" onClick={onRun} className="ml-auto inline-flex h-8 items-center gap-2 rounded bg-aegis-primary px-3 font-semibold text-white">
            <Play size={12} fill="currentColor" />立即运行
          </button>
        </footer>
      </section>
    </div>
  );
}
