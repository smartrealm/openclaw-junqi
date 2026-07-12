import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, X } from "lucide-react";

interface ProjectConfig {
  agent: { default: string; default_permission_mode: string; prompt_prefix: string };
  git: { commit_prompt: string; commit_message_timeout_secs: number };
}

export function AgentWorkspaceProjectSettingsDialog({
  projectPath,
  onClose,
}: {
  projectPath: string;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void invoke<ProjectConfig>("read_project_config", { projectPath })
      .then((value) => { if (!disposed) setConfig(value); })
      .catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [projectPath]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const save = async () => {
    if (!config || saving) return;
    const timeout = Number(config.git.commit_message_timeout_secs);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
      setError("提交消息生成超时必须在 1 到 120 秒之间。");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await invoke("write_project_config", { projectPath, config });
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[2147481000] flex items-center justify-center bg-black/55" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="项目设置" className="flex h-[min(680px,calc(100vh-64px))] w-[min(840px,calc(100vw-64px))] overflow-hidden rounded-lg border border-aegis-border bg-aegis-card shadow-2xl">
        <aside className="w-48 shrink-0 border-r border-aegis-border bg-aegis-surface p-3">
          <div className="mb-3 px-2 text-xs font-semibold text-aegis-text">设置</div>
          <div className="flex items-center gap-2 rounded bg-aegis-hover px-2 py-2 text-xs font-semibold text-aegis-text">
            <FolderOpen size={14} />项目设置
          </div>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center border-b border-aegis-border px-5">
            <h2 className="text-sm font-semibold text-aegis-text">项目设置</h2>
            <button type="button" onClick={onClose} title="关闭" className="ml-auto flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"><X size={15} /></button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {!config && !error && <p className="text-xs text-aegis-text-dim">正在加载...</p>}
            {error && <div role="alert" className="mb-4 rounded border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-400">{error}</div>}
            {config && <div className="space-y-6">
              <SettingsSection title="智能体">
                <Field label="默认智能体" hint="新任务默认选择的代码智能体">
                  <select value={config.agent.default} onChange={(event) => setConfig({ ...config, agent: { ...config.agent, default: event.target.value } })} className="w-full rounded border border-aegis-border bg-aegis-bg px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary">
                    <option value="claude">Claude Code</option><option value="codex">Codex</option>
                  </select>
                </Field>
                <Field label="默认权限模式" hint="新任务创建时使用的权限级别">
                  <select value={config.agent.default_permission_mode} onChange={(event) => setConfig({ ...config, agent: { ...config.agent, default_permission_mode: event.target.value } })} className="w-full rounded border border-aegis-border bg-aegis-bg px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary">
                    <option value="ask">每次询问</option><option value="auto_edit">自动编辑</option><option value="full_access">完全访问</option>
                  </select>
                </Field>
                <Field label="提示词前缀" hint="运行每个任务时自动添加到提示词前">
                  <textarea rows={3} value={config.agent.prompt_prefix} placeholder="例如：请使用中文回复。" onChange={(event) => setConfig({ ...config, agent: { ...config.agent, prompt_prefix: event.target.value } })} className="w-full resize-y rounded border border-aegis-border bg-aegis-bg px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary" />
                </Field>
              </SettingsSection>
              <SettingsSection title="Git">
                <Field label="生成超时" hint="AI 生成提交消息的最长等待时间（秒）">
                  <input type="number" min={1} max={120} value={config.git.commit_message_timeout_secs} onChange={(event) => setConfig({ ...config, git: { ...config.git, commit_message_timeout_secs: Number(event.target.value) } })} className="w-28 rounded border border-aegis-border bg-aegis-bg px-3 py-2 text-xs text-aegis-text outline-none focus:border-aegis-primary" />
                </Field>
                <Field label="提交消息提示词" hint="用于根据 Git diff 生成提交消息">
                  <textarea rows={8} value={config.git.commit_prompt} onChange={(event) => setConfig({ ...config, git: { ...config.git, commit_prompt: event.target.value } })} className="w-full resize-y rounded border border-aegis-border bg-aegis-bg px-3 py-2 font-mono text-[11px] text-aegis-text outline-none focus:border-aegis-primary" />
                </Field>
              </SettingsSection>
            </div>}
          </div>
          <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t border-aegis-border px-5">
            <button type="button" onClick={onClose} className="rounded border border-aegis-border px-3 py-1.5 text-xs text-aegis-text-dim hover:bg-aegis-hover">取消</button>
            <button type="button" disabled={!config || saving} onClick={() => void save()} className="rounded bg-aegis-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h3 className="mb-3 border-b border-aegis-border pb-2 text-xs font-semibold text-aegis-text">{title}</h3><div className="space-y-4">{children}</div></section>;
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return <label className="grid grid-cols-[180px_minmax(0,1fr)] gap-4"><span><span className="block text-xs font-medium text-aegis-text">{label}</span><span className="mt-1 block text-[11px] leading-4 text-aegis-text-dim">{hint}</span></span><span>{children}</span></label>;
}
