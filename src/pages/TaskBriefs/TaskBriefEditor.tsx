import { CheckCircle2, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskBriefFinding } from '@/task-briefs/checker';
import type {
  TaskBrief,
  TaskBriefCardKind,
  TaskBriefReferenceKind,
} from '@/task-briefs/domain';
import type { TaskBriefEditablePatch } from '@/stores/taskBriefStore';
import { TaskBriefCardsSection } from './TaskBriefCardsSection';
import { TaskBriefExecutionFields } from './TaskBriefExecutionFields';
import { TaskBriefReferencesSection } from './TaskBriefReferencesSection';

interface TaskBriefEditorProps {
  brief: TaskBrief;
  compiledPrompt: string;
  findings: readonly TaskBriefFinding[];
  launchError: string | null;
  preview: boolean;
  onAddCard: (kind: TaskBriefCardKind) => void;
  onAddReference: (kind: TaskBriefReferenceKind) => void;
  onDelete: () => void;
  onMoveCard: (cardId: string, direction: -1 | 1) => void;
  onRemoveCard: (cardId: string) => void;
  onRemoveReference: (referenceId: string) => void;
  onUpdateBrief: (patch: TaskBriefEditablePatch) => void;
  onUpdateCard: (cardId: string, content: string) => void;
  onUpdateReference: (
    referenceId: string,
    patch: { kind?: TaskBriefReferenceKind; label?: string; value?: string },
  ) => void;
}

export function TaskBriefEditor({
  brief,
  compiledPrompt,
  findings,
  launchError,
  preview,
  onAddCard,
  onAddReference,
  onDelete,
  onMoveCard,
  onRemoveCard,
  onRemoveReference,
  onUpdateBrief,
  onUpdateCard,
  onUpdateReference,
}: TaskBriefEditorProps) {
  const { t } = useTranslation();
  const archived = brief.status === 'archived';
  const blockingFindings = findings.filter((finding) => finding.severity === 'error');

  if (preview) {
    return <pre className="junqi-briefs-preview">{compiledPrompt}</pre>;
  }

  return (
    <div className="junqi-briefs-body">
      {archived && (
        <div className="junqi-briefs-archived" role="status">
          {t('taskBriefs.archivedReadOnly')}
        </div>
      )}

      <TaskBriefExecutionFields brief={brief} disabled={archived} onUpdate={onUpdateBrief} />

      <TaskBriefCardsSection
        brief={brief}
        disabled={archived}
        onAdd={onAddCard}
        onMove={onMoveCard}
        onRemove={onRemoveCard}
        onUpdate={onUpdateCard}
      />

      <TaskBriefReferencesSection
        brief={brief}
        disabled={archived}
        onAdd={onAddReference}
        onRemove={onRemoveReference}
        onUpdate={onUpdateReference}
      />

      <section className="junqi-briefs-findings" aria-live="polite">
        <header>
          {blockingFindings.length > 0 ? <TriangleAlert size={16} /> : <CheckCircle2 size={16} />}
          <strong>
            {t(blockingFindings.length > 0 ? 'taskBriefs.notReady' : 'taskBriefs.ready')}
          </strong>
        </header>
        {findings.map((finding, index) => (
          <div
            key={`${finding.code}:${finding.cardId ?? index}`}
            className={`is-${finding.severity}`}
          >
            {t(`taskBriefs.findings.${finding.code}`)}
          </div>
        ))}
        {launchError && <div className="is-error" role="alert">{launchError}</div>}
      </section>

      <button type="button" className="junqi-briefs-delete" onClick={onDelete}>
        <Trash2 size={13} />
        {t('taskBriefs.deleteBrief')}
      </button>
    </div>
  );
}
