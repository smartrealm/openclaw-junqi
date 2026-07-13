import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronDown, GitBranch, GitFork, Plus, Search, Tag, X } from 'lucide-react';

interface GitBranchInfo { name: string; current: boolean; remote: string | null }

function BranchCreateDialog({ projectPath, branches, onClose, onCreated }: {
  projectPath: string;
  branches: GitBranchInfo[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const current = branches.find((branch) => branch.current)?.name ?? 'HEAD';
  const [name, setName] = useState('');
  const [fromBranch, setFromBranch] = useState(current);
  const [query, setQuery] = useState('');
  const [selectingBase, setSelectingBase] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? branches.filter((branch) => branch.name.toLowerCase().includes(normalized)) : branches;
  }, [branches, query]);

  const create = async (checkout: boolean) => {
    const branchName = name.trim();
    if (!branchName || busy) return;
    setBusy(true); setError(null);
    try {
      await invoke('git_create_branch', { projectPath, branchName, fromBranch, checkout });
      await onCreated();
      onClose();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="新建分支" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Enter' && !selectingBase && !actionMenuOpen) void create(true); }} className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-aegis-border bg-aegis-surface p-4 shadow-2xl">
        <div className="mb-4 flex items-center gap-2"><GitBranch size={15} className="text-aegis-text-dim" /><h2 className="text-sm font-semibold">新建分支</h2><button type="button" title="关闭" onClick={onClose} className="ml-auto flex h-7 w-7 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover"><X size={14} /></button></div>
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] text-aegis-text-dim"><Tag size={11} />分支名称</label>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="feature/my-branch" className="mb-4 h-9 w-full rounded border border-aegis-border bg-aegis-bg px-2.5 text-xs outline-none focus:border-aegis-primary" />
        <label className="mb-1.5 flex items-center gap-1.5 text-[11px] text-aegis-text-dim"><GitFork size={11} />基于</label>
        <div className="relative mb-4">
          <button type="button" onClick={() => setSelectingBase((value) => !value)} className="flex h-9 w-full items-center rounded border border-aegis-border bg-aegis-bg px-2.5 text-left text-xs"><span className="min-w-0 flex-1 truncate font-mono">{fromBranch}</span><ChevronDown size={12} /></button>
          {selectingBase && <div className="absolute left-0 right-0 top-10 z-10 overflow-hidden rounded border border-aegis-border bg-aegis-surface shadow-xl">
            <div className="flex items-center gap-2 border-b border-aegis-border p-2"><Search size={12} className="text-aegis-text-dim" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索分支" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />{query && <button type="button" onClick={() => setQuery('')}><X size={11} /></button>}</div>
            <div className="max-h-48 overflow-y-auto py-1">{filtered.map((branch) => <button key={branch.name} type="button" onClick={() => { setFromBranch(branch.name); setSelectingBase(false); setQuery(''); }} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-aegis-hover"><GitBranch size={11} /><span className="min-w-0 flex-1 truncate font-mono">{branch.name}</span>{fromBranch === branch.name && <Check size={12} className="text-aegis-primary" />}</button>)}{!filtered.length && <p className="px-3 py-3 text-center text-[11px] text-aegis-text-dim">未找到分支</p>}</div>
          </div>}
        </div>
        {error && <p className="mb-3 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[10px] text-red-400">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-8 rounded border border-aegis-border px-3 text-xs text-aegis-text-dim hover:bg-aegis-hover">取消</button><div className="relative"><button type="button" disabled={!name.trim() || busy} onClick={() => setActionMenuOpen((value) => !value)} className="flex h-8 items-center gap-2 rounded bg-aegis-primary px-3 text-xs font-semibold text-white disabled:opacity-40">{busy ? '创建中...' : '创建并切换'}<ChevronDown size={11} /></button>{actionMenuOpen && <div className="absolute bottom-10 right-0 z-10 w-40 overflow-hidden rounded border border-aegis-border bg-aegis-surface py-1 shadow-xl"><button type="button" onClick={() => void create(true)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-aegis-hover"><GitFork size={12} />创建并切换</button><button type="button" onClick={() => void create(false)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-aegis-hover"><Plus size={12} />仅创建</button></div>}</div></div>
      </div>
    </div>
  );
}

export function AgentWorkspaceBranchBar({ projectPath, active = true }: { projectPath: string; active?: boolean }) {
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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
          <button type="button" onClick={() => { setOpen(false); setQuery(''); setShowCreateDialog(true); }} className="flex w-full items-center gap-2 border-t border-aegis-border px-2.5 py-2 text-left text-xs text-aegis-primary hover:bg-aegis-hover"><Plus size={12} />新建分支</button>
          {error && <p className="border-t border-red-500/20 px-2 py-1.5 text-[10px] text-red-400">{error}</p>}
        </div>
      )}
      {showCreateDialog && <BranchCreateDialog projectPath={projectPath} branches={branches} onClose={() => setShowCreateDialog(false)} onCreated={refresh} />}
    </div>
  );
}
