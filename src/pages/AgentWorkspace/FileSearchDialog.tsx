import { invoke } from '@tauri-apps/api/core';
import { FileCode2, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface ProjectFileSearchResult {
  path: string;
  name: string;
  dir: string;
  extension: string;
}

const FILTERS = [
  { id: 'all', label: '全部类型', extensions: [] as string[] },
  { id: 'ts', label: 'TS / TSX', extensions: ['ts', 'tsx'] },
  { id: 'js', label: 'JS / JSX', extensions: ['js', 'jsx', 'mjs', 'cjs'] },
  { id: 'rust', label: 'Rust', extensions: ['rs'] },
  { id: 'web', label: 'Web', extensions: ['html', 'css', 'scss'] },
  { id: 'data', label: '配置', extensions: ['json', 'jsonc', 'toml', 'yaml', 'yml', 'env'] },
  { id: 'docs', label: '文档', extensions: ['md', 'mdx', 'txt'] },
];

export function AgentWorkspaceFileSearchDialog({
  projectPath,
  onFileOpen,
  onClose,
}: {
  projectPath: string;
  onFileOpen: (path: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filterId, setFilterId] = useState('all');
  const [results, setResults] = useState<ProjectFileSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const filter = useMemo(
    () => FILTERS.find((item) => item.id === filterId) ?? FILTERS[0],
    [filterId],
  );
  const searchActive = Boolean(query.trim()) || filter.extensions.length > 0;

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  useEffect(() => {
    requestId.current += 1;
    const currentRequest = requestId.current;
    if (!searchActive) {
      setResults([]);
      setActiveIndex(0);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    const timeout = window.setTimeout(() => {
      invoke<ProjectFileSearchResult[]>('search_project_files', {
        projectPath,
        query: query.trim(),
        extensions: filter.extensions,
        limit: 80,
      }).then((nextResults) => {
        if (currentRequest !== requestId.current) return;
        setResults(nextResults);
        setActiveIndex(0);
      }).catch((reason: unknown) => {
        if (currentRequest !== requestId.current) return;
        setResults([]);
        setError(String(reason));
      }).finally(() => {
        if (currentRequest === requestId.current) setLoading(false);
      });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [filter.extensions, projectPath, query, searchActive]);

  const openResult = (result: ProjectFileSearchResult | undefined) => {
    if (!result) return;
    onFileOpen(result.path, result.name);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={onClose}>
      <section
        className="flex max-h-[70vh] w-[min(680px,calc(100vw-32px))] flex-col overflow-hidden rounded-md border border-aegis-border bg-aegis-surface shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        aria-label="搜索项目文件"
      >
        <div className="flex items-center gap-2 border-b border-aegis-border px-3 py-2">
          <Search size={15} className="text-aegis-text-dim" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(results.length - 1, index + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(0, index - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                openResult(results[activeIndex]);
              }
            }}
            placeholder="搜索当前项目文件"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-aegis-text-dim"
          />
          <select
            value={filterId}
            onChange={(event) => setFilterId(event.target.value)}
            aria-label="文件类型"
            className="max-w-28 rounded border border-aegis-border bg-aegis-bg px-1.5 py-1 text-[11px] text-aegis-text outline-none"
          >
            {FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <button
            type="button"
            onClick={onClose}
            title="关闭搜索"
            className="flex h-6 w-6 items-center justify-center rounded text-aegis-text-dim hover:bg-aegis-hover hover:text-aegis-text"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto p-1.5">
          {!searchActive ? (
            <p className="px-2 py-8 text-center text-xs text-aegis-text-dim">输入名称开始搜索</p>
          ) : loading ? (
            <p className="px-2 py-8 text-center text-xs text-aegis-text-dim">正在搜索...</p>
          ) : error ? (
            <p className="px-2 py-8 text-center text-xs text-red-400">搜索失败：{error}</p>
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-aegis-text-dim">没有匹配文件</p>
          ) : results.map((result, index) => (
            <button
              key={result.path}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => openResult(result)}
              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left ${activeIndex === index ? 'bg-aegis-primary/10' : 'hover:bg-aegis-hover'}`}
            >
              <FileCode2 size={14} className="shrink-0 text-aegis-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-aegis-text">{result.name}</span>
                <span className="block truncate font-mono text-[10px] text-aegis-text-dim">{result.dir || result.path}</span>
              </span>
              {result.extension && <span className="text-[10px] uppercase text-aegis-text-dim">{result.extension}</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
