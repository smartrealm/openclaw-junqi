import { useEffect, useRef, useState } from 'react';
import { AlertCircle, FileText, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  OpenClawAgentBootstrapFile,
  OpenClawAgentBootstrapFileGet,
} from '@/services/gateway';
import { FilePreviewSurface } from '@/components/FileExplorer/FilePreviewSurface';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { textFilePreviewContent } from '@/file-preview/content';
import { formatBytes } from '@/utils/format';

interface AgentBootstrapFilesPanelProps {
  agentId: string;
  files: readonly OpenClawAgentBootstrapFile[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  getFile: (agentId: string, name: string) => Promise<OpenClawAgentBootstrapFileGet>;
}

export function AgentBootstrapFilesPanel({
  agentId,
  files,
  loading,
  error,
  onRetry,
  getFile,
}: AgentBootstrapFilesPanelProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<OpenClawAgentBootstrapFile | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileUnavailable, setFileUnavailable] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setSelected(null);
    setLoadingFile(false);
    setFileUnavailable(false);
    requestIdRef.current += 1;
  }, [agentId]);

  const openFile = (file: OpenClawAgentBootstrapFile) => {
    if (file.missing) {
      setSelected(file);
      setFileUnavailable(false);
      return;
    }
    const nextRequestId = ++requestIdRef.current;
    setLoadingFile(true);
    setFileUnavailable(false);
    setSelected(null);
    void getFile(agentId, file.name)
      .then((result) => {
        if (nextRequestId === requestIdRef.current) setSelected(result.file);
      })
      .catch(() => {
        if (nextRequestId === requestIdRef.current) setFileUnavailable(true);
      })
      .finally(() => {
        if (nextRequestId === requestIdRef.current) setLoadingFile(false);
      });
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-aegis-text-muted">
          <FileText size={10} />
          {t('agentSettings.bootstrapFiles', 'Agent bootstrap files')}
        </div>
        {!loading && !error && (
          <span className="text-[9px] font-bold text-aegis-text-dim">{files.length}</span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)]">
        {loading ? (
          <div className="flex items-center gap-2 px-3.5 py-3 text-[11px] text-aegis-text-dim">
            <LoadingIndicator size={13} />
            {t('agentSettings.loadingBootstrapFiles', 'Loading bootstrap files…')}
          </div>
        ) : error ? (
          <div className="flex items-start gap-2.5 px-3.5 py-3">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-aegis-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-aegis-danger">{t('agentSettings.bootstrapFilesUnavailable', 'Bootstrap files are unavailable')}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-aegis-primary hover:underline"
              >
                <RefreshCw size={10} />
                {t('common.retry', 'Retry')}
              </button>
            </div>
          </div>
        ) : files.length === 0 ? (
          <p className="px-3.5 py-3 text-[10px] text-aegis-text-dim">{t('agentSettings.bootstrapFilesEmpty', 'No bootstrap files were returned')}</p>
        ) : (
          <div className="divide-y divide-[rgb(var(--aegis-overlay)/0.06)]">
            {files.map((file) => (
              <button
                key={file.name}
                type="button"
                onClick={() => openFile(file)}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-start transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
              >
                <FileText size={13} className="shrink-0 text-aegis-primary" />
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-aegis-text">{file.name}</span>
                {file.missing ? (
                  <span className="shrink-0 text-[9px] text-aegis-text-dim">
                    {file.expectedAbsent
                      ? t('agentSettings.bootstrapFileExpectedAbsent', 'Optional')
                      : t('agentSettings.bootstrapFileMissing', 'Missing')}
                  </span>
                ) : file.size !== undefined ? (
                  <span className="shrink-0 text-[9px] text-aegis-text-dim">{formatBytes(file.size)}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
      {(loadingFile || fileUnavailable || selected) && (
        <div className="mt-2 overflow-hidden rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.025)]">
          {loadingFile && (
            <div className="flex items-center gap-2 px-3.5 py-3 text-[11px] text-aegis-text-dim">
              <LoadingIndicator size={13} />
              {t('agentSettings.loadingBootstrapFile', 'Loading file…')}
            </div>
          )}
          {fileUnavailable && (
            <div className="flex items-center gap-2 px-3.5 py-3 text-[10px] text-aegis-danger">
              <AlertCircle size={13} />
              {t('agentSettings.bootstrapFileUnavailable', 'File preview is unavailable')}
            </div>
          )}
          {selected && !loadingFile && (
            selected.missing ? (
              <p className="px-3.5 py-3 text-[10px] text-aegis-text-dim">
                {selected.expectedAbsent
                  ? t('agentSettings.bootstrapFileExpectedAbsentHint', 'This optional file has not been created by OpenClaw.')
                  : t('agentSettings.bootstrapFileMissingHint', 'OpenClaw reported that this file is missing.')}
              </p>
            ) : selected.content !== undefined ? (
              <FilePreviewSurface
                content={textFilePreviewContent(selected.name, selected.content)}
                fileName={selected.name}
                compact
              />
            ) : (
              <div className="flex items-center gap-2 px-3.5 py-3 text-[10px] text-aegis-danger">
                <AlertCircle size={13} />
                {t('agentSettings.bootstrapFileUnavailable', 'File preview is unavailable')}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
