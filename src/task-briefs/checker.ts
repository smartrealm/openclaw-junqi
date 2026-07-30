import type { TaskBrief } from './domain';

export interface TaskBriefFinding {
  code:
    | 'brief-archived'
    | 'project-required'
    | 'goal-required'
    | 'acceptance-required'
    | 'ambiguous-language'
    | 'reference-incomplete'
    | 'context-suggested';
  severity: 'error' | 'warning' | 'suggestion';
  cardId?: string;
}

const AMBIGUOUS_PATTERNS = [
  /(?:把|将)?(?:它|这个|那个|这块|这里)(?:给我)?(?:优化|完善|处理|改)(?:一下)?/i,
  /(?:优化|完善|处理|改进)(?:一下|一下子)?$/i,
  /make\s+it\s+(?:better|nicer|faster)/i,
  /improve\s+(?:this|that|it)$/i,
];

export function checkTaskBrief(brief: TaskBrief): TaskBriefFinding[] {
  const findings: TaskBriefFinding[] = [];
  const nonEmpty = brief.cards.filter((card) => card.content.trim());
  if (brief.status === 'archived') findings.push({ code: 'brief-archived', severity: 'error' });
  if (!brief.projectPath.trim()) findings.push({ code: 'project-required', severity: 'error' });
  if (!nonEmpty.some((card) => card.kind === 'goal')) findings.push({ code: 'goal-required', severity: 'error' });
  if (!nonEmpty.some((card) => card.kind === 'acceptance')) findings.push({ code: 'acceptance-required', severity: 'error' });
  for (const card of nonEmpty) {
    if (AMBIGUOUS_PATTERNS.some((pattern) => pattern.test(card.content.trim()))) {
      findings.push({ code: 'ambiguous-language', severity: 'warning', cardId: card.id });
    }
  }
  for (const reference of brief.references) {
    if (!reference.label.trim() || !reference.value.trim()) {
      findings.push({ code: 'reference-incomplete', severity: 'warning' });
    }
  }
  if (!nonEmpty.some((card) => card.kind === 'constraint') && brief.references.length === 0) {
    findings.push({ code: 'context-suggested', severity: 'suggestion' });
  }
  return findings;
}

export function taskBriefIsReady(brief: TaskBrief): boolean {
  return !checkTaskBrief(brief).some((finding) => finding.severity === 'error');
}
