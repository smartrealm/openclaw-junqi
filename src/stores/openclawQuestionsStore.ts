import { create } from 'zustand';
import {
  gateway,
  subscribeGatewayQuestionEvents,
} from '@/services/gateway';
import type {
  OpenClawPendingQuestion,
  OpenClawQuestionAnswers,
} from '@/services/gateway/OpenClawQuestionClient';

interface OpenClawQuestionsState {
  readonly questions: readonly OpenClawPendingQuestion[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly errorRequestId: string | null;
  readonly resolvingId: string | null;
  refresh(connected: boolean, showLoading?: boolean): Promise<void>;
  subscribeLiveUpdates(connected: boolean): () => void;
  resolve(
    connected: boolean,
    id: string,
    answers: OpenClawQuestionAnswers,
    secretStoreAllowedHosts?: readonly string[],
  ): Promise<void>;
  cancel(connected: boolean, id: string): Promise<void>;
}

export const OPENCLAW_QUESTION_REQUEST_FAILED = 'OPENCLAW_QUESTION_REQUEST_FAILED';

let requestSequence = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : OPENCLAW_QUESTION_REQUEST_FAILED;
}

function sortQuestions(questions: readonly OpenClawPendingQuestion[]): readonly OpenClawPendingQuestion[] {
  return [...questions].sort((left, right) => (
    left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id)
  ));
}

export const useOpenClawQuestionsStore = create<OpenClawQuestionsState>((set, get) => ({
  questions: [],
  loading: false,
  error: null,
  errorRequestId: null,
  resolvingId: null,
  refresh: async (connected, showLoading = true) => {
    requestSequence += 1;
    const sequence = requestSequence;
    if (!connected) {
      set({
        questions: [],
        loading: false,
        error: null,
        errorRequestId: null,
        resolvingId: null,
      });
      return;
    }
    if (showLoading) set({ loading: true });
    try {
      const questions = await gateway.listPendingQuestions();
      if (sequence !== requestSequence) return;
      set({
        questions: sortQuestions(questions),
        loading: false,
        error: null,
        errorRequestId: null,
      });
    } catch (error) {
      if (sequence !== requestSequence) return;
      set({ loading: false, error: errorMessage(error), errorRequestId: null });
    }
  },
  subscribeLiveUpdates: (connected) => {
    if (!connected) return () => undefined;
    const unsubscribe = subscribeGatewayQuestionEvents((event) => {
      if (event.phase === 'resolved') {
        set((state) => ({
          questions: state.questions.filter((question) => question.id !== event.id),
          resolvingId: state.resolvingId === event.id ? null : state.resolvingId,
          error: null,
          errorRequestId: null,
        }));
        return;
      }
      set((state) => ({
        questions: sortQuestions([
          ...state.questions.filter((question) => question.id !== event.question.id),
          event.question,
        ]),
        error: null,
        errorRequestId: null,
      }));
    });
    return unsubscribe;
  },
  resolve: async (connected, id, answers, secretStoreAllowedHosts) => {
    if (!connected) {
      set({ error: null, errorRequestId: null });
      return;
    }
    set({ resolvingId: id, error: null, errorRequestId: null });
    try {
      await gateway.resolveQuestion(id, answers, secretStoreAllowedHosts);
      set((state) => ({
        questions: state.questions.filter((question) => question.id !== id),
        error: null,
        errorRequestId: null,
      }));
    } catch (error) {
      set({ error: errorMessage(error), errorRequestId: id });
    } finally {
      if (get().resolvingId === id) set({ resolvingId: null });
    }
  },
  cancel: async (connected, id) => {
    if (!connected) {
      set({ error: null, errorRequestId: null });
      return;
    }
    set({ resolvingId: id, error: null, errorRequestId: null });
    try {
      await gateway.cancelQuestion(id);
      set((state) => ({
        questions: state.questions.filter((question) => question.id !== id),
        error: null,
        errorRequestId: null,
      }));
    } catch (error) {
      set({ error: errorMessage(error), errorRequestId: id });
    } finally {
      if (get().resolvingId === id) set({ resolvingId: null });
    }
  },
}));
