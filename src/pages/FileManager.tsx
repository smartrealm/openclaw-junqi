import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageTransition } from '@/components/shared/PageTransition';
import { WorkspaceFileManager } from './file-manager/WorkspaceFileManager';

export function FileManagerPage() {
  const { t } = useTranslation();

  return (
    <PageTransition className="flex h-full min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-[rgb(var(--aegis-overlay)/0.06)] px-4 py-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-aegis-primary/30 bg-aegis-primary/15">
          <FolderOpen size={15} className="text-aegis-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-bold text-aegis-text">{t('fileManager.title')}</h1>
          <p className="text-[11px] text-aegis-text-dim">{t('fileManager.treeViewDesc')}</p>
        </div>
      </header>
      <WorkspaceFileManager />
    </PageTransition>
  );
}
