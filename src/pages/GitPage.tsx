import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, GitBranch, ShieldCheck } from 'lucide-react';
import { GitChanges, GitDiffViewer } from '@/components/Git';
import { desktopFileRuntime } from '@/runtime/desktopFileRuntime';
import { openTerminalWorkspaceDirectory } from '@/api/tauri-commands';

const GIT_WORKSPACE_STORAGE_KEY = 'git-workspace-directory';

function savedWorkspacePath(): string {
  try {
    return localStorage.getItem(GIT_WORKSPACE_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

function saveWorkspacePath(path: string): void {
  try {
    localStorage.setItem(GIT_WORKSPACE_STORAGE_KEY, path);
  } catch {
    return;
  }
}

export default function GitPage() {
  const { t } = useTranslation();
  const [projectPath, setProjectPath] = useState(savedWorkspacePath);
  const [workspaceTrusted, setWorkspaceTrusted] = useState(false);
  const [selectingWorkspace, setSelectingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [diffView, setDiffView] = useState<{
    filePath: string;
    staged: boolean;
    label: string;
  } | null>(null);

  const selectWorkspace = useCallback(async () => {
    if (selectingWorkspace) return;
    setSelectingWorkspace(true);
    setWorkspaceError(null);
    try {
      const selectedPath = await desktopFileRuntime.selectDirectory();
      if (!selectedPath) return;
      const directory = await openTerminalWorkspaceDirectory(selectedPath);
      saveWorkspacePath(directory.path);
      setProjectPath(directory.path);
      setWorkspaceTrusted(true);
      setDiffView(null);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setSelectingWorkspace(false);
    }
  }, [selectingWorkspace]);

  const handleFileSelect = useCallback((filePath: string, staged: boolean, label: string) => {
    setDiffView({ filePath, staged, label });
  }, []);

  if (diffView) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-aegis-bg">
        <GitDiffViewer
          projectPath={projectPath}
          mode="file"
          filePath={diffView.filePath}
          staged={diffView.staged}
          title={diffView.label}
          onClose={() => setDiffView(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-aegis-bg">
      <header className="flex flex-wrap items-center gap-3 border-b border-aegis-border bg-aegis-card px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch size={17} className="shrink-0 text-aegis-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-aegis-text">{t('gitPage.title', 'Git 管理')}</h1>
            <p className="mt-0.5 truncate font-mono text-[10px] text-aegis-text-dim">{projectPath || t('gitPage.noWorkspace', '尚未选择工作区')}</p>
          </div>
        </div>
        <div className="ms-auto flex min-w-0 items-center gap-2">
          <span className="hidden items-center gap-1 text-[10px] text-aegis-text-dim lg:inline-flex"><ShieldCheck size={11} aria-hidden="true" />{t('gitPage.workspaceBoundary', '由桌面端核验的本地工作区')}</span>
          <button type="button" onClick={() => void selectWorkspace()} disabled={selectingWorkspace} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-aegis-border px-3 text-[11px] font-medium text-aegis-text-secondary transition-colors hover:bg-aegis-hover hover:text-aegis-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 disabled:cursor-wait disabled:opacity-50">
            <FolderOpen size={13} aria-hidden="true" />{selectingWorkspace ? t('gitPage.selectingWorkspace', '正在核验') : t('gitPage.selectWorkspace', '选择工作区')}
          </button>
        </div>
        {workspaceError && <p className="basis-full text-[10.5px] text-aegis-danger" role="alert">{workspaceError}</p>}
      </header>
      {!projectPath || !workspaceTrusted ? (
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderOpen size={28} className="text-aegis-text-dim" aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-aegis-text">{projectPath ? t('gitPage.reconfirmWorkspaceTitle', '重新确认 Git 工作区') : t('gitPage.noWorkspaceTitle', '选择 Git 工作区')}</h2>
          <p className="max-w-md text-[11px] leading-5 text-aegis-text-dim">{projectPath ? t('gitPage.reconfirmWorkspacePrompt', '已保存的路径不会在新桌面会话中自动获得 Git 操作权限。请通过系统目录选择器重新确认。') : t('gitPage.workspacePrompt', '选择一个本地目录后，JunQi 会使用桌面端返回的规范化路径读取 Git 状态。变更操作继续使用现有的 Git 控件与结果反馈。')}</p>
          <button type="button" onClick={() => void selectWorkspace()} disabled={selectingWorkspace} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-aegis-primary px-3 text-[11px] font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aegis-primary/50 disabled:cursor-wait disabled:opacity-50">
            <FolderOpen size={13} aria-hidden="true" />{t('gitPage.selectWorkspace', '选择工作区')}
          </button>
        </main>
      ) : (
        <main className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 flex-1 items-center justify-center px-6 text-center text-[11px] text-aegis-text-dim">
            {t('gitPage.selectFile', '从变更面板选择文件以查看差异。')}
          </div>
          <GitChanges projectPath={projectPath} onFileSelect={handleFileSelect} width={320} />
        </main>
      )}
    </div>
  );
}
