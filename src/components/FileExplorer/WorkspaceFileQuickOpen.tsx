import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { File, LoaderCircle, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceFileSearchEntry, WorkspaceFileSearchResult } from '@/workspace-files/domain/types';
import { nextWorkspaceFileQuickOpenIndex } from './workspaceFileQuickOpenModel';

interface WorkspaceFileQuickOpenProps {
  open: boolean;
  projectName: string;
  onClose: () => void;
  onOpenFile: (path: string, name: string) => void;
  onSearch: (query: string) => Promise<WorkspaceFileSearchResult>;
}

export function WorkspaceFileQuickOpen({
  open,
  projectName,
  onClose,
  onOpenFile,
  onSearch,
}: WorkspaceFileQuickOpenProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<WorkspaceFileSearchEntry[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const selectEntry = useCallback((entry: WorkspaceFileSearchEntry | undefined) => {
    if (!entry) return;
    onOpenFile(entry.path, entry.name);
    onClose();
  }, [onClose, onOpenFile]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    requestIdRef.current += 1;
    if (!open) {
      setQuery('');
      setEntries([]);
      setStatus('idle');
      setSelectedIndex(-1);
    }
  }, [open]);

  useEffect(() => {
    const trimmedQuery = query.trim();
    const requestId = ++requestIdRef.current;
    if (!open || !trimmedQuery) {
      setEntries([]);
      setStatus('idle');
      setSelectedIndex(-1);
      return;
    }

    setStatus('loading');
    const timer = window.setTimeout(() => {
      void onSearch(trimmedQuery).then((result) => {
        if (requestId !== requestIdRef.current) return;
        setEntries(result.entries);
        setSelectedIndex(result.entries.length > 0 ? 0 : -1);
        setStatus('idle');
      }).catch(() => {
        if (requestId !== requestIdRef.current) return;
        setEntries([]);
        setSelectedIndex(-1);
        setStatus('error');
      });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [onSearch, open, query]);

  if (!open) return null;

  return createPortal(
    <div className="workspace-file-quick-open-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="workspace-file-quick-open"
        role="dialog"
        aria-modal="true"
        aria-label={t('file.quickOpen', 'Quick open')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="workspace-file-quick-open-header">
          <span>{t('file.quickOpen', 'Quick open')}</span>
          <span>{projectName}</span>
          <button type="button" onClick={onClose} aria-label={t('file.closeQuickOpen', 'Close quick open')} title={t('file.closeQuickOpen', 'Close quick open')}>
            <X size={15} />
          </button>
        </header>
        <label className="workspace-file-quick-open-input">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('file.quickOpenPlaceholder', 'Search tracked files')}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
                return;
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelectedIndex((index) => nextWorkspaceFileQuickOpenIndex(index, entries.length, event.key === 'ArrowDown' ? 'next' : 'previous'));
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                selectEntry(entries[selectedIndex]);
              }
            }}
          />
          {status === 'loading' ? <LoaderCircle className="workspace-file-quick-open-spinner" size={15} aria-label={t('file.searching', 'Searching')} /> : null}
          <kbd>Ctrl/Cmd+P</kbd>
        </label>
        <div className="workspace-file-quick-open-results" role="listbox" aria-label={t('file.quickOpenResults', 'File search results')}>
          {!query.trim() ? <div className="workspace-file-quick-open-empty">{t('file.quickOpenHint', 'Search files in this worktree')}</div> : null}
          {status === 'error' ? <div className="workspace-file-quick-open-empty">{t('file.searchUnavailable', 'Search unavailable')}</div> : null}
          {status === 'idle' && query.trim() && entries.length === 0 ? <div className="workspace-file-quick-open-empty">{t('file.noMatchingFiles', 'No matching files')}</div> : null}
          {entries.map((entry, index) => (
            <button
              key={entry.path}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={index === selectedIndex ? 'is-selected' : ''}
              onMouseMove={() => setSelectedIndex(index)}
              onClick={() => selectEntry(entry)}
            >
              <File size={15} aria-hidden="true" />
              <span className="workspace-file-quick-open-file-name">{entry.name}</span>
              <span className="workspace-file-quick-open-directory">{entry.directory || t('file.worktreeRoot', 'Worktree root')}</span>
            </button>
          ))}
        </div>
      </section>
    </div>,
    document.body,
  );
}
