import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, GitBranch, Plus, Search, X } from 'lucide-react';

interface GitBranchInfo { name: string; current: boolean; remote: string | null }

export function AgentWorkspaceBranchBar({ projectPath, active = true }: { projectPath: string; active?: boolean }) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!projectPath || !active) return;
    const request = ++requestRef.current;
    try {
      const result = await invoke<GitBranchInfo[]>('git_list_branches', { projectPath });
      if (request === requestRef.current) setBranches(result);
    } catch (reason) {
      if (request === requestRef.current) setError(String(reason));
    }
  }, [active, projectPath]);

  useEffect(() => { void refresh(); }, [refresh]);
  const current = branches.find((branch) => branch.current)?.name ?? '';
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? branches.filter((branch) => branch.name.toLowerCase().includes(normalized)) : branches;
  }, [branches, query]);

  const checkout = async (branch: GitBranchInfo) => {
    if (busy || branch.current) return;
    setBusy(true); setError(null);
    try {
      await invoke('git_checkout_branch', { projectPath, branchName: branch.name, isRemote: Boolean(branch.remote) });
      await refresh(); setOpen(false); setQuery('');
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  const createBranch = async () => {
    const name = newBranchName.trim();
    if (!name || busy) return;
    setBusy(true); setError(null);
    try {
      await invoke('git_create_branch', { projectPath, branchName: name, fromBranch: current || 'HEAD', checkout: true });
      await refresh(); setNewBranchName(''); setOpen(false);
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  return (
    <div className="relative mx-3 mb-2">
      <button type="button" disabled={!projectPath} onClick={() => setOpen((value) => !value)} className="flex h-8 w-full items-center gap-2 rounded-md border border-aegis-border bg-aegis-bg px-2 text-left text-xs text-aegis-text-dim hover:text-aegis-text disabled:opacity-40">
        <GitBranch size={13} /><span className="min-w-0 flex-1 truncate font-mono">{current || '未检测到 Git 分支'}</span><ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-9 z-50 overflow-hidden rounded-md border border-aegis-border bg-aegis-surface shadow-xl">
          <div className="flex items-center gap-1.5 border-b border-aegis-border p-2">
            <Search size={12} className="text-aegis-text-dim" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="搜索分支" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
            {query && <button type="button" onClick={() => setQuery('')}><X size={11} /></button>}
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.map((branch) => <button key={branch.name} type="button" disabled={busy} onClick={() => void checkout(branch)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-aegis-hover disabled:cursor-wait"><GitBranch size={11} /><span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>{branch.current && <Check size={12} className="text-aegis-primary" />}</button>)}
            {!filtered.length && <p className="px-3 py-3 text-center text-[11px] text-aegis-text-dim">未找到分支</p>}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void createBranch(); }} className="flex gap-1.5 border-t border-aegis-border p-2">
            <input value={newBranchName} onChange={(event) => setNewBranchName(event.target.value)} placeholder="feature/my-branch" className="min-w-0 flex-1 rounded border border-aegis-border bg-aegis-bg px-2 py-1 text-xs outline-none" />
            <button type="submit" title="新建并切换" disabled={!newBranchName.trim() || busy} className="flex h-7 w-7 items-center justify-center rounded bg-aegis-primary text-white disabled:opacity-40"><Plus size={12} /></button>
          </form>
          {error && <p className="border-t border-red-500/20 px-2 py-1.5 text-[10px] text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

