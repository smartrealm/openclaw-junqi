import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

type PermissionMode = AgentWorkspaceTask['permissionMode'];
const AGENTS = ['claude', 'codex'] as const;
const PERMISSIONS: PermissionMode[] = ['ask', 'auto_edit', 'full_access'];
const PERMISSION_LABEL: Record<PermissionMode, string> = { ask: '询问权限', auto_edit: '自动编辑', full_access: '完全访问' };

export function AgentWorkspaceTaskEditDialog({ task, onSave, onClose }: {
  task: AgentWorkspaceTask;
  onSave: (patch: Pick<AgentWorkspaceTask, 'prompt' | 'agent' | 'permissionMode'>) => void;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState(task.prompt);
  const [agent, setAgent] = useState(task.agent === 'codex' ? 'codex' : 'claude');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(task.permissionMode);
  const valid = Boolean(prompt.trim());

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return createPortal(
    <div role="presentation" className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="agent-workspace-task-edit-title" className="flex w-full max-w-2xl flex-col overflow-hidden rounded-md border border-aegis-border bg-aegis-surface shadow-2xl">
        <header className="flex h-11 items-center justify-between border-b border-aegis-border px-4">
          <h2 id="agent-workspace-task-edit-title" className="text-sm font-semibold text-aegis-text">编辑任务</h2>
          <button type="button" title="关闭" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"><X size={14} /></button>
        </header>
        <div className="flex flex-col gap-3 p-4">
          <textarea autoFocus value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-40 max-h-[50vh] resize-y rounded-md border border-aegis-border bg-aegis-bg px-3 py-2 text-sm leading-6 text-aegis-text outline-none focus:border-aegis-primary" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-aegis-border p-0.5" aria-label="Agent">
              {AGENTS.map((value) => <button key={value} type="button" onClick={() => setAgent(value)} className={`h-7 rounded px-3 text-xs ${agent === value ? 'bg-aegis-primary text-white' : 'text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text'}`}>{value === 'claude' ? 'Claude Code' : 'Codex'}</button>)}
            </div>
            <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as PermissionMode)} className="h-8 rounded border border-aegis-border bg-aegis-bg px-2 text-xs text-aegis-text outline-none focus:border-aegis-primary">
              {PERMISSIONS.map((value) => <option key={value} value={value}>{PERMISSION_LABEL[value]}</option>)}
            </select>
            <span className="flex-1" />
            <button type="button" onClick={onClose} className="h-8 rounded border border-aegis-border px-3 text-xs text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text">取消</button>
            <button type="button" disabled={!valid} onClick={() => valid && onSave({ prompt: prompt.trim(), agent, permissionMode })} className="h-8 rounded bg-aegis-primary px-4 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">保存</button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
