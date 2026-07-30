import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { taskBriefIsReady } from '@/task-briefs/checker';
import {
  TASK_BRIEF_CARD_KINDS,
  TASK_BRIEF_REFERENCE_KINDS,
  TASK_BRIEF_TEXT_LIMITS,
  createTaskBrief,
  type TaskBrief,
  type TaskBriefCard,
  type TaskBriefReference,
} from '@/task-briefs/domain';

export type TaskBriefEditablePatch = Partial<Pick<
  TaskBrief,
  'title' | 'projectPath' | 'agent' | 'permissionMode' | 'planMode' | 'launchMode' | 'baseBranch'
>>;

export interface TaskBriefState {
  briefs: TaskBrief[];
  selectedBriefId: string | null;
  createBrief: () => TaskBrief;
  selectBrief: (id: string | null) => void;
  updateBrief: (id: string, patch: TaskBriefEditablePatch) => void;
  removeBrief: (id: string) => void;
  setBriefArchived: (id: string, archived: boolean) => void;
  addCard: (briefId: string, card: TaskBriefCard) => void;
  updateCard: (briefId: string, cardId: string, patch: Partial<Omit<TaskBriefCard, 'id'>>) => void;
  removeCard: (briefId: string, cardId: string) => void;
  moveCard: (briefId: string, cardId: string, direction: -1 | 1) => void;
  addReference: (briefId: string, reference: TaskBriefReference) => void;
  updateReference: (briefId: string, referenceId: string, patch: Partial<Omit<TaskBriefReference, 'id'>>) => void;
  removeReference: (briefId: string, referenceId: string) => void;
  markLaunched: (briefId: string, taskId: string) => void;
}

function boundedString(value: unknown, maxLength: number, allowEmpty = true): value is string {
  return typeof value === 'string'
    && value.length <= maxLength
    && (allowEmpty || value.trim().length > 0);
}

function validBrief(value: unknown): value is TaskBrief {
  if (!value || typeof value !== 'object') return false;
  const brief = value as Partial<TaskBrief>;
  return boundedString(brief.id, 512, false)
    && boundedString(brief.title, TASK_BRIEF_TEXT_LIMITS.title)
    && boundedString(brief.projectPath, TASK_BRIEF_TEXT_LIMITS.projectPath)
    && (brief.status === 'draft' || brief.status === 'ready' || brief.status === 'launched' || brief.status === 'archived')
    && Array.isArray(brief.cards)
    && brief.cards.every((card) => card
      && boundedString(card.id, 512, false)
      && TASK_BRIEF_CARD_KINDS.includes(card.kind)
      && boundedString(card.content, TASK_BRIEF_TEXT_LIMITS.cardContent))
    && Array.isArray(brief.references)
    && brief.references.every((reference) => reference
      && boundedString(reference.id, 512, false)
      && TASK_BRIEF_REFERENCE_KINDS.includes(reference.kind)
      && boundedString(reference.label, TASK_BRIEF_TEXT_LIMITS.referenceLabel)
      && boundedString(reference.value, TASK_BRIEF_TEXT_LIMITS.referenceValue))
    && (brief.agent === 'claude' || brief.agent === 'codex' || brief.agent === 'pi')
    && (brief.permissionMode === 'ask' || brief.permissionMode === 'auto_edit' || brief.permissionMode === 'full_access')
    && typeof brief.planMode === 'boolean'
    && (brief.launchMode === 'local' || brief.launchMode === 'worktree')
    && (brief.baseBranch === undefined || boundedString(brief.baseBranch, 512))
    && (brief.launchedTaskId === undefined || boundedString(brief.launchedTaskId, 512, false))
    && typeof brief.createdAt === 'number' && Number.isFinite(brief.createdAt)
    && typeof brief.updatedAt === 'number' && Number.isFinite(brief.updatedAt);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function editableStatus(brief: TaskBrief): 'draft' | 'ready' {
  return taskBriefIsReady({ ...brief, status: 'draft' }) ? 'ready' : 'draft';
}

function afterExecutionEdit(brief: TaskBrief): TaskBrief {
  return {
    ...brief,
    status: brief.status === 'archived' ? 'archived' : editableStatus(brief),
    launchedTaskId: undefined,
  };
}

function updateBriefs(
  briefs: TaskBrief[],
  id: string,
  update: (brief: TaskBrief) => TaskBrief,
): TaskBrief[] {
  return briefs.map((brief) => {
    if (brief.id !== id) return brief;
    const next = update(brief);
    return next === brief ? brief : { ...next, updatedAt: Date.now() };
  });
}

function clipped(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

export const useTaskBriefStore = create<TaskBriefState>()(persist(
  (set) => ({
    briefs: [],
    selectedBriefId: null,
    createBrief: () => {
      const brief = createTaskBrief();
      set((state) => ({ briefs: [brief, ...state.briefs], selectedBriefId: brief.id }));
      return brief;
    },
    selectBrief: (selectedBriefId) => set((state) => ({
      selectedBriefId: selectedBriefId === null || state.briefs.some((brief) => brief.id === selectedBriefId)
        ? selectedBriefId
        : state.selectedBriefId,
    })),
    updateBrief: (id, patch) => set((state) => ({
      briefs: updateBriefs(state.briefs, id, (brief) => afterExecutionEdit({
        ...brief,
        ...patch,
        title: patch.title === undefined ? brief.title : clipped(patch.title, TASK_BRIEF_TEXT_LIMITS.title),
        projectPath: patch.projectPath === undefined
          ? brief.projectPath
          : clipped(patch.projectPath, TASK_BRIEF_TEXT_LIMITS.projectPath),
        baseBranch: patch.baseBranch === undefined ? brief.baseBranch : clipped(patch.baseBranch, 512),
      })),
    })),
    removeBrief: (id) => set((state) => {
      const briefs = state.briefs.filter((brief) => brief.id !== id);
      return {
        briefs,
        selectedBriefId: state.selectedBriefId === id ? briefs[0]?.id ?? null : state.selectedBriefId,
      };
    }),
    setBriefArchived: (id, archived) => set((state) => ({
      briefs: updateBriefs(state.briefs, id, (brief) => ({
        ...brief,
        status: archived
          ? 'archived'
          : brief.launchedTaskId
            ? 'launched'
            : editableStatus(brief),
      })),
    })),
    addCard: (briefId, card) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => {
        if (
          brief.cards.some((candidate) => candidate.id === card.id)
          || !TASK_BRIEF_CARD_KINDS.includes(card.kind)
        ) return brief;
        return afterExecutionEdit({
          ...brief,
          cards: [...brief.cards, {
            ...card,
            content: clipped(card.content, TASK_BRIEF_TEXT_LIMITS.cardContent),
          }],
        });
      }),
    })),
    updateCard: (briefId, cardId, patch) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => {
        if (patch.kind !== undefined && !TASK_BRIEF_CARD_KINDS.includes(patch.kind)) return brief;
        if (!brief.cards.some((card) => card.id === cardId)) return brief;
        return afterExecutionEdit({
          ...brief,
          cards: brief.cards.map((card) => card.id === cardId ? {
            ...card,
            ...patch,
            content: patch.content === undefined
              ? card.content
              : clipped(patch.content, TASK_BRIEF_TEXT_LIMITS.cardContent),
          } : card),
        });
      }),
    })),
    removeCard: (briefId, cardId) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => brief.cards.some((card) => card.id === cardId)
        ? afterExecutionEdit({ ...brief, cards: brief.cards.filter((card) => card.id !== cardId) })
        : brief),
    })),
    moveCard: (briefId, cardId, direction) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => {
        const index = brief.cards.findIndex((card) => card.id === cardId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= brief.cards.length) return brief;
        const cards = [...brief.cards];
        [cards[index], cards[nextIndex]] = [cards[nextIndex], cards[index]];
        return afterExecutionEdit({ ...brief, cards });
      }),
    })),
    addReference: (briefId, reference) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => {
        if (
          brief.references.some((candidate) => candidate.id === reference.id)
          || !TASK_BRIEF_REFERENCE_KINDS.includes(reference.kind)
        ) return brief;
        return afterExecutionEdit({
          ...brief,
          references: [...brief.references, {
            ...reference,
            label: clipped(reference.label, TASK_BRIEF_TEXT_LIMITS.referenceLabel),
            value: clipped(reference.value, TASK_BRIEF_TEXT_LIMITS.referenceValue),
          }],
        });
      }),
    })),
    updateReference: (briefId, referenceId, patch) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => {
        if (patch.kind !== undefined && !TASK_BRIEF_REFERENCE_KINDS.includes(patch.kind)) return brief;
        if (!brief.references.some((reference) => reference.id === referenceId)) return brief;
        return afterExecutionEdit({
          ...brief,
          references: brief.references.map((reference) => reference.id === referenceId ? {
            ...reference,
            ...patch,
            label: patch.label === undefined
              ? reference.label
              : clipped(patch.label, TASK_BRIEF_TEXT_LIMITS.referenceLabel),
            value: patch.value === undefined
              ? reference.value
              : clipped(patch.value, TASK_BRIEF_TEXT_LIMITS.referenceValue),
          } : reference),
        });
      }),
    })),
    removeReference: (briefId, referenceId) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => brief.references.some((reference) => reference.id === referenceId)
        ? afterExecutionEdit({
          ...brief,
          references: brief.references.filter((reference) => reference.id !== referenceId),
        })
        : brief),
    })),
    markLaunched: (briefId, taskId) => set((state) => ({
      briefs: updateBriefs(state.briefs, briefId, (brief) => ({
        ...brief,
        status: 'launched',
        launchedTaskId: clipped(taskId, 512),
      })),
    })),
  }),
  {
    name: 'junqi:task-briefs:v1',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    merge: (persisted, current) => {
      const candidate = persisted as Partial<TaskBriefState> | undefined;
      const briefs = uniqueById(
        Array.isArray(candidate?.briefs) ? candidate.briefs.filter(validBrief) : [],
      );
      return {
        ...current,
        briefs,
        selectedBriefId: briefs.some((brief) => brief.id === candidate?.selectedBriefId)
          ? candidate?.selectedBriefId ?? null
          : briefs[0]?.id ?? null,
      };
    },
    partialize: (state) => ({ briefs: state.briefs, selectedBriefId: state.selectedBriefId }),
  },
));
