import { Archive, ArchiveRestore, Crosshair, FileText, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskBrief } from '@/task-briefs/domain';

interface TaskBriefToolbarProps {
  brief: TaskBrief;
  preview: boolean;
  launchBlocked: boolean;
  onArchiveChange: (archived: boolean) => void;
  onFocus: () => void;
  onLaunch: () => void;
  onTogglePreview: () => void;
}

export function TaskBriefToolbar({
  brief,
  preview,
  launchBlocked,
  onArchiveChange,
  onFocus,
  onLaunch,
  onTogglePreview,
}: TaskBriefToolbarProps) {
  const { t } = useTranslation();
  const archived = brief.status === 'archived';
  const focusLabel = t('focus.set');
  const previewLabel = t('taskBriefs.preview');
  const archiveLabel = t(archived ? 'taskBriefs.restore' : 'taskBriefs.archive');
  const launchLabel = t(brief.status === 'launched' ? 'taskBriefs.openTask' : 'taskBriefs.launch');

  return (
    <header className="junqi-briefs-toolbar">
      <div>
        <span>{t('taskBriefs.brief')}</span>
        <strong>{brief.title || t('taskBriefs.untitled')}</strong>
      </div>
      <div>
        <button type="button" onClick={onFocus} title={focusLabel} aria-label={focusLabel}>
          <Crosshair size={14} />
          {focusLabel}
        </button>
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={preview}
          title={previewLabel}
          aria-label={previewLabel}
        >
          <FileText size={14} />
          {previewLabel}
        </button>
        <button
          type="button"
          onClick={() => onArchiveChange(!archived)}
          title={archiveLabel}
          aria-label={archiveLabel}
        >
          {archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {archiveLabel}
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={launchBlocked}
          onClick={onLaunch}
          title={launchLabel}
          aria-label={launchLabel}
        >
          <Play size={14} />
          {launchLabel}
        </button>
      </div>
    </header>
  );
}
