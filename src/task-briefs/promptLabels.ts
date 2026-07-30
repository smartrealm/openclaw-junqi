import type { TaskBriefPromptLabels } from './compiler';

export type TaskBriefPromptTranslate = (key: string) => string;

export function taskBriefPromptLabels(t: TaskBriefPromptTranslate): TaskBriefPromptLabels {
  return {
    task: t('taskBriefs.prompt.task'),
    untitled: t('taskBriefs.prompt.untitled'),
    project: t('taskBriefs.prompt.project'),
    references: t('taskBriefs.prompt.references'),
    sections: {
      goal: t('taskBriefs.cardKinds.goal'),
      background: t('taskBriefs.cardKinds.background'),
      constraint: t('taskBriefs.cardKinds.constraint'),
      acceptance: t('taskBriefs.cardKinds.acceptance'),
      note: t('taskBriefs.cardKinds.note'),
    },
  };
}
