import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FolderSearch } from 'lucide-react';
import type { FileViewerHandle, OpenFileTab, ThemeVariant } from '@/components/FileExplorer/FileViewer';
import {
  pathIsTargetOrDescendant,
  rebaseOpenFilePath,
  rebaseOpenFileTabs,
  removeOpenFileTabs,
} from '@/components/FileExplorer/openFilePaths';
import { parseFilePreviewRoute } from '@/components/FileExplorer/filePreviewRoute';
import { LoadingIndicator } from '@/components/shared/LoadingIndicator';
import { enqueueTerminalCommand } from '@/services/terminalCommandQueue';
import { useTheme } from '@/theme/useTheme';

const FileExplorer = lazy(() => import('@/components/FileExplorer/FileExplorer').then((module) => ({ default: module.FileExplorer })));
const FileViewer = lazy(() => import('@/components/FileExplorer/FileViewer').then((module) => ({ default: module.FileViewer })));

function initialWorkspacePath(routePath: string | null): string {
  if (routePath) return routePath;
  try {
    return localStorage.getItem('aegis:workspaceRoot') ?? '';
  } catch {
    return '';
  }
}

export function WorkspaceFileManager() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resolvedTheme = useTheme();
  const themeVariant = resolvedTheme.replace('aegis-', '') as ThemeVariant;
  const [searchParams] = useSearchParams();
  const initialRoute = parseFilePreviewRoute(searchParams);
  const [projectPath, setProjectPath] = useState(() => initialWorkspacePath(initialRoute.projectPath));
  const [tabs, setTabs] = useState<OpenFileTab[]>(() => initialRoute.file ? [initialRoute.file] : []);
  const [activePath, setActivePath] = useState<string | null>(initialRoute.file?.path ?? null);
  const viewerRef = useRef<FileViewerHandle>(null);

  const openFile = useCallback((path: string, name: string) => {
    setTabs((current) => current.some((tab) => tab.path === path) ? current : [...current, { path, name }]);
    setActivePath(path);
  }, []);

  const closeTab = useCallback((path: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab.path !== path);
      setActivePath((active) => active === path ? (next.at(-1)?.path ?? null) : active);
      return next;
    });
  }, []);

  const onPathRenamed = useCallback((oldPath: string, newPath: string, isDirectory: boolean) => {
    setTabs((current) => rebaseOpenFileTabs(current, oldPath, newPath, isDirectory));
    setActivePath((current) => current ? rebaseOpenFilePath(current, oldPath, newPath, isDirectory) : null);
  }, []);

  const onPathDeleted = useCallback((path: string, isDirectory: boolean) => {
    setTabs((current) => {
      const next = removeOpenFileTabs(current, path, isDirectory);
      setActivePath((active) => (
        !active || !pathIsTargetOrDescendant(active, path, isDirectory) ? active : (next.at(-1)?.path ?? null)
      ));
      return next;
    });
  }, []);

  const routeKey = searchParams.toString();
  useEffect(() => {
    const route = parseFilePreviewRoute(new URLSearchParams(routeKey));
    if (route.projectPath) setProjectPath(route.projectPath);
    if (route.file) openFile(route.file.path, route.file.name);
  }, [openFile, routeKey]);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActivePath(null);
  }, []);

  const closeTabsToRight = useCallback((path: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === path);
      return index < 0 ? current : current.slice(0, index + 1);
    });
  }, []);

  const closeTabsToLeft = useCallback((path: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === path);
      return index < 0 ? current : current.slice(index);
    });
  }, []);

  return (
    <div className="flex min-h-0 flex-1">
      <Suspense fallback={<TreeLoading />}>
        <FileExplorer
          projectPath={projectPath}
          projectName={projectPath.split(/[\\/]/).pop() || 'project'}
          onFileSelect={openFile}
          onPathRenamed={onPathRenamed}
          onPathDeleted={onPathDeleted}
          onBeforePathMutation={(path, isDirectory) => viewerRef.current?.flushPath(path, isDirectory) ?? Promise.resolve()}
          width={260}
        />
      </Suspense>
      {tabs.length > 0 && activePath ? (
        <Suspense fallback={<ViewerLoading />}>
          <FileViewer
            ref={viewerRef}
            tabs={tabs}
            activeFilePath={activePath}
            projectPath={projectPath}
            themeVariant={themeVariant}
            onSelectTab={setActivePath}
            onCloseTab={closeTab}
            onFileMissing={closeTab}
            onCloseOtherTabs={(path) => setTabs((current) => current.filter((tab) => tab.path === path))}
            onCloseTabsToRight={closeTabsToRight}
            onCloseTabsToLeft={closeTabsToLeft}
            onCloseAllTabs={closeAllTabs}
            onOpenFile={openFile}
            onRunMakeTarget={(target) => {
              enqueueTerminalCommand({ command: `make -- ${target}\n`, projectPath });
              navigate('/terminal');
            }}
          />
        </Suspense>
      ) : <EmptyWorkspace t={t} />}
    </div>
  );
}

function TreeLoading() {
  return <div className="flex w-[260px] shrink-0 items-center justify-center border-e border-[rgb(var(--aegis-overlay)/0.06)]"><LoadingIndicator size={16} /></div>;
}

function ViewerLoading() {
  return <div className="flex flex-1 items-center justify-center"><LoadingIndicator size={18} /></div>;
}

function EmptyWorkspace({ t }: { t: (key: string, options?: Record<string, unknown>) => string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl border border-[rgb(var(--aegis-overlay)/0.08)] bg-[rgb(var(--aegis-overlay)/0.04)]">
        <FolderSearch size={20} className="text-aegis-text-dim" aria-hidden="true" />
      </div>
      <p className="text-[12px] text-aegis-text-dim">{t('fileManager.selectFileTree')}</p>
    </div>
  );
}
