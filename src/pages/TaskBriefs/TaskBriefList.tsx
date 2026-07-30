import { FileText, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskBrief } from '@/task-briefs/domain';

interface TaskBriefListProps {
  briefs: readonly TaskBrief[];
  selectedBriefId: string | null;
  onCreate: () => void;
  onSelect: (briefId: string) => void;
}

export function TaskBriefList({ briefs, selectedBriefId, onCreate, onSelect }: TaskBriefListProps) {
  const { t } = useTranslation();

  return (
    <aside className="junqi-briefs-list">
      <header>
        <div>
          <span>{t('taskBriefs.kicker')}</span>
          <strong>{t('taskBriefs.title')}</strong>
        </div>
        <button type="button" onClick={onCreate} title={t('taskBriefs.new')} aria-label={t('taskBriefs.new')}>
          <Plus size={15} />
        </button>
      </header>

      <div className="junqi-briefs-list-scroll">
        {briefs.length === 0 ? (
          <div className="junqi-briefs-list-empty">
            <FileText size={24} />
            <span>{t('taskBriefs.empty')}</span>
            <button type="button" onClick={onCreate}>{t('taskBriefs.createFirst')}</button>
          </div>
        ) : briefs.map((brief) => (
          <button
            key={brief.id}
            type="button"
            className={brief.id === selectedBriefId ? 'is-active' : ''}
            onClick={() => onSelect(brief.id)}
          >
            <strong>{brief.title || t('taskBriefs.untitled')}</strong>
            <small>{brief.projectPath || t('taskBriefs.noProject')}</small>
            <span>{t(`taskBriefs.status.${brief.status}`)}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
