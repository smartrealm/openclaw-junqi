import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  TASK_BRIEF_CARD_KINDS,
  TASK_BRIEF_TEXT_LIMITS,
  createTaskBriefEntityId,
  type TaskBrief,
  type TaskBriefCardKind,
} from '@/task-briefs/domain';

interface TaskBriefCardsSectionProps {
  brief: TaskBrief;
  disabled: boolean;
  onAdd: (kind: TaskBriefCardKind) => void;
  onMove: (cardId: string, direction: -1 | 1) => void;
  onRemove: (cardId: string) => void;
  onUpdate: (cardId: string, content: string) => void;
}

export function TaskBriefCardsSection({
  brief,
  disabled,
  onAdd,
  onMove,
  onRemove,
  onUpdate,
}: TaskBriefCardsSectionProps) {
  const { t } = useTranslation();

  return (
    <section className="junqi-briefs-section">
      <div className="junqi-briefs-section-title">
        <div>
          <strong>{t('taskBriefs.cards')}</strong>
          <span>{t('taskBriefs.cardsHint')}</span>
        </div>
        <select
          value=""
          disabled={disabled}
          aria-label={t('taskBriefs.addCard')}
          onChange={(event) => {
            const kind = event.target.value as TaskBriefCardKind;
            if (TASK_BRIEF_CARD_KINDS.includes(kind)) onAdd(kind);
          }}
        >
          <option value="">{t('taskBriefs.addCard')}</option>
          {TASK_BRIEF_CARD_KINDS.map((kind) => (
            <option key={kind} value={kind}>{t(`taskBriefs.cardKinds.${kind}`)}</option>
          ))}
        </select>
      </div>

      <div className="junqi-briefs-cards">
        {brief.cards.map((card, index) => (
          <article key={card.id} className={`is-${card.kind}`}>
            <header>
              <span>{t(`taskBriefs.cardKinds.${card.kind}`)}</span>
              <div>
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => onMove(card.id, -1)}
                  title={t('taskBriefs.moveUp')}
                  aria-label={t('taskBriefs.moveUp')}
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  disabled={disabled || index === brief.cards.length - 1}
                  onClick={() => onMove(card.id, 1)}
                  title={t('taskBriefs.moveDown')}
                  aria-label={t('taskBriefs.moveDown')}
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onRemove(card.id)}
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </header>
            <textarea
              value={card.content}
              disabled={disabled}
              maxLength={TASK_BRIEF_TEXT_LIMITS.cardContent}
              onChange={(event) => onUpdate(card.id, event.target.value)}
              placeholder={t(`taskBriefs.cardPlaceholders.${card.kind}`)}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

export function createEmptyTaskBriefCard(kind: TaskBriefCardKind) {
  return { id: createTaskBriefEntityId('card'), kind, content: '' };
}
