import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { formatBytes } from '@/utils/format';

export interface AgentWorkspaceEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'directory';
  readonly size?: number;
}

export interface AgentWorkspaceListing {
  readonly path: string;
  readonly parentPath?: string;
  readonly entries: readonly AgentWorkspaceEntry[];
}

export interface AgentWorkspaceFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly mimeType: string;
  readonly encoding: 'utf8' | 'base64';
  readonly content: string;
}

interface OpenClawAgentWorkspacePanelProps {
  agentId: string;
  listWorkspace: (input: { agentId: string; path?: string }) => Promise<AgentWorkspaceListing>;
  getWorkspaceFile: (agentId: string, path: string) => Promise<AgentWorkspaceFile>;
  onClose?: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 只呈现 Gateway 所返回的 Agent 工作区，不访问本机文件系统。 */
export function OpenClawAgentWorkspacePanel({
  agentId,
  listWorkspace,
  getWorkspaceFile,
  onClose,
}: OpenClawAgentWorkspacePanelProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<AgentWorkspaceListing | null>(null);
  const [listingError, setListingError] = useState<string | null>(null);
  const [loadingListing, setLoadingListing] = useState(true);
  const [selectedFile, setSelectedFile] = useState<AgentWorkspaceFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const listRequestRef = useRef(0);
  const fileRequestRef = useRef(0);

  useEffect(() => {
    const requestId = ++listRequestRef.current;
    setLoadingListing(true);
    setListingError(null);
    setSelectedFile(null);
    setFileError(null);
    void listWorkspace({ agentId, ...(path ? { path } : {}) })
      .then((result) => {
        if (requestId !== listRequestRef.current) return;
        setListing(result);
      })
      .catch((error) => {
        if (requestId !== listRequestRef.current) return;
        setListing(null);
        setListingError(errorMessage(error));
      })
      .finally(() => {
        if (requestId === listRequestRef.current) setLoadingListing(false);
      });
  }, [agentId, listWorkspace, path, refreshVersion]);

  const breadcrumbs = useMemo(() => {
    if (!path) return [];
    const segments = path.split('/');
    return segments.map((name, index) => ({ name, path: segments.slice(0, index + 1).join('/') }));
  }, [path]);

  const openEntry = useCallback((entry: AgentWorkspaceEntry) => {
    if (entry.kind === 'directory') {
      setPath(entry.path);
      return;
    }
    const requestId = ++fileRequestRef.current;
    setLoadingFile(true);
    setFileError(null);
    setSelectedFile(null);
    void getWorkspaceFile(agentId, entry.path)
      .then((result) => {
        if (requestId === fileRequestRef.current) setSelectedFile(result);
      })
      .catch((error) => {
        if (requestId === fileRequestRef.current) setFileError(errorMessage(error));
      })
      .finally(() => {
        if (requestId === fileRequestRef.current) setLoadingFile(false);
      });
  }, [agentId, getWorkspaceFile]);

  const selectParent = useCallback(() => {
    setPath(listing?.parentPath ?? '');
  }, [listing?.parentPath]);

  const imageSource = selectedFile?.encoding === 'base64'
    ? `data:${selectedFile.mimeType};base64,${selectedFile.content}`
    : null;

  return (
    <div className="flex h-full min-h-0 w-full bg-aegis-bg-frosted-60">
      <aside className="flex w-[clamp(210px,24%,300px)] shrink-0 flex-col border-e border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.018)]">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3">
          <FolderOpen size={14} className="shrink-0 text-aegis-primary" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-aegis-text">
            {t('agentWorkspaceBrowser.title', 'Agent workspace')}
          </span>
          <button
            type="button"
            onClick={() => setRefreshVersion((version) => version + 1)}
            title={t('common.refresh', 'Refresh')}
            className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary"
          >
            <RefreshCw size={13} />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t('workspace.collapse', 'Collapse workspace')}
              className="rounded p-1 text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.08)] hover:text-aegis-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-aegis-primary"
            >
              <ChevronLeft size={15} />
            </button>
          )}
        </div>
        <div className="border-b border-[rgb(var(--aegis-overlay)/0.08)] px-2 py-1.5 text-[10px] text-aegis-text-dim">
          <p className="truncate" title={agentId}>{agentId}</p>
          <p className="mt-0.5">{t('agentWorkspaceBrowser.readOnly', 'Read-only Gateway view')}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 py-1">
          {path && (
            <button
              type="button"
              onClick={selectParent}
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] text-aegis-text-muted hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
            >
              <FolderOpen size={13} className="text-aegis-primary/70" />
              {t('agentWorkspaceBrowser.parent', 'Parent directory')}
            </button>
          )}
          {loadingListing && (
            <div className="flex justify-center py-5"><LoadingIndicator size={16} label={t('agentWorkspaceBrowser.loading', 'Loading workspace')} /></div>
          )}
          {listingError && (
            <div className="m-1.5 rounded border border-aegis-danger/30 bg-aegis-danger/10 px-2 py-2 text-[10px] text-aegis-text-secondary">
              <p>{t('agentWorkspaceBrowser.unavailable', 'Gateway workspace is unavailable')}</p>
              <p className="mt-1 break-words text-aegis-text-dim">{listingError}</p>
            </div>
          )}
          {!loadingListing && !listingError && listing?.entries.length === 0 && (
            <p className="p-4 text-center text-[11px] text-aegis-text-dim">{t('agentWorkspaceBrowser.empty', 'This directory is empty')}</p>
          )}
          {listing?.entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              onClick={() => openEntry(entry)}
              title={entry.path}
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-start text-[11px] text-aegis-text-muted transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)] hover:text-aegis-text"
            >
              {entry.kind === 'directory'
                ? <Folder size={13} className="shrink-0 text-aegis-primary/70" />
                : <File size={13} className="shrink-0 text-aegis-text-dim" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.size !== undefined && <span className="shrink-0 text-[9px] text-aegis-text-dim">{formatBytes(entry.size)}</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-aegis-bg">
        <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-[rgb(var(--aegis-overlay)/0.08)] px-3 text-[11px] text-aegis-text-dim">
          <button type="button" onClick={() => setPath('')} className="hover:text-aegis-primary">{t('agentWorkspaceBrowser.root', 'Root')}</button>
          {breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <span>/</span>
              <button type="button" onClick={() => setPath(crumb.path)} className="hover:text-aegis-primary">{crumb.name}</button>
            </span>
          ))}
        </div>
        {loadingFile && (
          <div className="flex min-h-0 flex-1 items-center justify-center"><LoadingIndicator size={22} label={t('agentWorkspaceBrowser.loadingFile', 'Loading file')} /></div>
        )}
        {fileError && (
          <div className="m-4 rounded border border-aegis-danger/30 bg-aegis-danger/10 px-3 py-2 text-[11px] text-aegis-text-secondary">
            <p>{t('agentWorkspaceBrowser.fileUnavailable', 'File preview is unavailable')}</p>
            <p className="mt-1 break-words text-aegis-text-dim">{fileError}</p>
          </div>
        )}
        {selectedFile && !loadingFile && (
          imageSource ? (
            <div className="min-h-0 flex flex-1 items-center justify-center overflow-auto p-6">
              <img src={imageSource} alt={selectedFile.name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-5 text-aegis-text">{selectedFile.content}</pre>
          )
        )}
        {!selectedFile && !loadingFile && !fileError && (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
            <div>
              <FolderOpen size={30} className="mx-auto mb-3 text-aegis-text-dim opacity-30" />
              <p className="text-[12px] font-medium text-aegis-text-muted">{t('agentWorkspaceBrowser.selectFile', 'Select a file to preview')}</p>
              <p className="mt-1 text-[10px] text-aegis-text-dim">{t('agentWorkspaceBrowser.readOnly', 'Read-only Gateway view')}</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
