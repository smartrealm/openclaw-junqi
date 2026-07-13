import { useEffect, useState } from "react";
import { Pencil, Play, X } from "lucide-react";
import type { AgentWorkspaceTask } from "@/stores/agentWorkspaceStore";

const PERMISSION_LABEL: Record<AgentWorkspaceTask["permissionMode"], string> = {
  ask: "询问权限",
  auto_edit: "自动编辑",
  full_access: "完全访问",
};

export function AgentWorkspaceTodoTaskView({
  task,
  onRun,
  onUpdate,
}: {
  task: AgentWorkspaceTask;
  onRun: () => void;
  onUpdate: (patch: Pick<AgentWorkspaceTask, "prompt" | "agent" | "permissionMode">) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [prompt, setPrompt] = useState(task.prompt);
  const [agent, setAgent] = useState<"claude" | "codex">(task.agent === "codex" ? "codex" : "claude");
  const [permissionMode, setPermissionMode] = useState(task.permissionMode);

  useEffect(() => {
    setEditing(false);
    setPrompt(task.prompt);
    setAgent(task.agent === "codex" ? "codex" : "claude");
    setPermissionMode(task.permissionMode);
  }, [task.id, task.prompt, task.agent, task.permissionMode]);

  const cancelEditing = () => {
    setPrompt(task.prompt);
    setAgent(task.agent === "codex" ? "codex" : "claude");
    setPermissionMode(task.permissionMode);
    setEditing(false);
  };

  return (
    <div className="flex h-full items-center justify-center px-12">
      <section className="flex w-full max-w-[700px] flex-col gap-4 rounded-lg border border-aegis-border bg-aegis-card p-6 shadow-sm">
        <header className="flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase text-aegis-text-dim">待办任务</span>
          {!editing && (
            <button type="button" title="编辑任务" onClick={() => setEditing(true)} className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">
              <Pencil size={13} />
            </button>
          )}
        </header>
        {editing ? (
          <>
            <textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-32 max-h-80 w-full resize-y rounded-md border border-aegis-border bg-aegis-bg px-3 py-2 text-sm leading-6 text-aegis-text outline-none focus:border-aegis-primary" />
            <footer className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => setAgent((value) => value === "claude" ? "codex" : "claude")} className="h-8 rounded border border-aegis-border px-3 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{agent === "claude" ? "Claude Code" : "Codex"}</button>
              <button type="button" onClick={() => setPermissionMode((value) => value === "ask" ? "auto_edit" : value === "auto_edit" ? "full_access" : "ask")} className="h-8 rounded border border-aegis-border px-3 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">{PERMISSION_LABEL[permissionMode]}</button>
              <span className="flex-1" />
              <button type="button" onClick={cancelEditing} className="inline-flex h-8 items-center gap-1.5 rounded border border-aegis-border px-3 text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"><X size={12} />取消</button>
              <button type="button" disabled={!prompt.trim()} onClick={() => { if (!prompt.trim()) return; onUpdate({ prompt: prompt.trim(), agent, permissionMode }); setEditing(false); }} className="h-8 rounded bg-aegis-primary px-4 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">保存</button>
            </footer>
          </>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-aegis-text">{task.prompt}</div>
            <footer className="flex flex-wrap items-center gap-2 text-xs text-aegis-text-dim">
              <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">{task.agent === "codex" ? "Codex" : "Claude Code"}</span>
              <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">{PERMISSION_LABEL[task.permissionMode]}</span>
              {task.launchMode === "worktree" && <span className="rounded border border-aegis-border bg-aegis-surface px-2 py-1">工作树</span>}
              <button type="button" onClick={onRun} className="ml-auto inline-flex h-8 items-center gap-2 rounded bg-aegis-primary px-3 font-semibold text-white"><Play size={12} fill="currentColor" />立即运行</button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
