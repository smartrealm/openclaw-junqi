import type {
  OpenClawPendingQuestion,
  OpenClawQuestion,
  OpenClawQuestionAnswers,
} from '@/services/gateway/OpenClawQuestionClient';

export type OpenClawQuestionAnswerSelection = Readonly<Record<string, readonly string[]>>;
export type OpenClawQuestionFreeTextAnswers = Readonly<Record<string, string>>;

export function buildOpenClawQuestionAnswers(
  prompt: OpenClawPendingQuestion,
  selected: OpenClawQuestionAnswerSelection,
  freeText: OpenClawQuestionFreeTextAnswers,
): OpenClawQuestionAnswers {
  return Object.fromEntries(prompt.questions.map((question) => {
    const custom = question.isSecret
      ? freeText[question.questionId] ?? ''
      : freeText[question.questionId]?.trim() ?? '';
    return [
      question.questionId,
      [...(selected[question.questionId] ?? []), ...(custom ? [custom] : [])],
    ];
  }));
}

export function normalizeOpenClawQuestionAllowedHosts(value: string): readonly string[] {
  return [...new Set(value.split(/[\s,]+/).map((host) => host.trim()).filter(Boolean))];
}

export function openClawQuestionHasAnswer(
  question: OpenClawQuestion,
  selected: OpenClawQuestionAnswerSelection,
  freeText: OpenClawQuestionFreeTextAnswers,
): boolean {
  return (selected[question.questionId]?.length ?? 0) > 0
    || Boolean(question.isSecret
      ? freeText[question.questionId]
      : freeText[question.questionId]?.trim());
}
