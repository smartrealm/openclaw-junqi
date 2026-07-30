import { Link2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  TASK_BRIEF_REFERENCE_KINDS,
  TASK_BRIEF_TEXT_LIMITS,
  createTaskBriefEntityId,
  type TaskBrief,
  type TaskBriefReferenceKind,
} from '@/task-briefs/domain';

interface TaskBriefReferencesSectionProps {
  brief: TaskBrief;
  disabled: boolean;
  onAdd: (kind: TaskBriefReferenceKind) => void;
  onRemove: (referenceId: string) => void;
  onUpdate: (
    referenceId: string,
    patch: { kind?: TaskBriefReferenceKind; label?: string; value?: string },
  ) => void;
}

export function TaskBriefReferencesSection({
  brief,
  disabled,
  onAdd,
  onRemove,
  onUpdate,
}: TaskBriefReferencesSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="junqi-briefs-section">
      <div className="junqi-briefs-section-title">
        <div>
          <strong>{t('taskBriefs.references')}</strong>
          <span>{t('taskBriefs.referencesHint')}</span>
        </div>
        <select
          value=""
          disabled={disabled}
          aria-label={t('taskBriefs.addReference')}
          onChange={(event) => {
            const kind = event.target.value as TaskBriefReferenceKind;
            if (TASK_BRIEF_REFERENCE_KINDS.includes(kind)) onAdd(kind);
          }}
        >
          <option value="">{t('taskBriefs.addReference')}</option>
          {TASK_BRIEF_REFERENCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(`taskBriefs.referenceKinds.${kind}`)}</option>
          ))}
        </select>
      </div>

      {brief.references.length === 0 ? (
        <div className="junqi-briefs-reference-empty">{t('taskBriefs.noReferences')}</div>
      ) : (
        <div className="junqi-briefs-references">
          {brief.references.map((reference) => (
            <div key={reference.id}>
              <Link2 size={14} />
              <select
                value={reference.kind}
                disabled={disabled}
                aria-label={t('taskBriefs.referenceType')}
                onChange={(event) => onUpdate(reference.id, {
                  kind: event.target.value as TaskBriefReferenceKind,
                })}
              >
                {TASK_BRIEF_REFERENCE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{t(`taskBriefs.referenceKinds.${kind}`)}</option>
                ))}
              </select>
              <input
                value={reference.label}
                disabled={disabled}
                maxLength={TASK_BRIEF_TEXT_LIMITS.referenceLabel}
                placeholder={t('taskBriefs.referenceLabel')}
                aria-label={t('taskBriefs.referenceLabel')}
                onChange={(event) => onUpdate(reference.id, { label: event.target.value })}
              />
              <input
                value={reference.value}
                disabled={disabled}
                maxLength={TASK_BRIEF_TEXT_LIMITS.referenceValue}
                placeholder={t('taskBriefs.referenceValue')}
                aria-label={t('taskBriefs.referenceValue')}
                onChange={(event) => onUpdate(reference.id, { value: event.target.value })}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onRemove(reference.id)}
                title={t('common.delete')}
                aria-label={t('common.delete')}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function createEmptyTaskBriefReference(kind: TaskBriefReferenceKind) {
  return { id: createTaskBriefEntityId('ref'), kind, label: '', value: '' };
}
