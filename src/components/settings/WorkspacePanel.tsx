/**
 * Workspace settings panel — STUB.
 *
 * Per SPEC §6 M5: stub for workspace path configuration, indexing options,
 * and ignore patterns. The managed-files indexer already exists; this panel
 * just exposes config UI for it.
 */
import { useTranslation } from 'react-i18next';
import { FolderTree } from 'lucide-react';
import { GlassCard } from '@/components/shared/GlassCard';

export function WorkspacePanel() {
  const { t } = useTranslation();
  return (
    <GlassCard>
      <h3 className="text-[14px] font-semibold text-aegis-text mb-4 flex items-center gap-2">
        <FolderTree size={16} className="text-aegis-primary" />
        {t('settings.workspace.title', 'Workspace')}
      </h3>
      <div className="rounded-lg border border-aegis-border/20 bg-[rgb(var(--aegis-overlay)/0.02)] p-4 text-[12px] text-aegis-text-dim leading-relaxed">
        {t('settings.workspace.stubHint', 'Workspace path picker, indexing options, and ignore patterns — coming soon. The managed-files indexer already runs; this panel exposes its configuration in a follow-up milestone.')}
      </div>
    </GlassCard>
  );
}