import type { TaskBrief, TaskBriefCardKind } from './domain';

export interface TaskBriefPromptLabels {
  task: string;
  untitled: string;
  project: string;
  references: string;
  sections: Record<TaskBriefCardKind, string>;
}

const SECTION_ORDER: ReadonlyArray<{ kind: TaskBriefCardKind; checklist?: boolean }> = [
  { kind: 'goal' },
  { kind: 'background' },
  { kind: 'constraint' },
  { kind: 'acceptance', checklist: true },
  { kind: 'note' },
];

export function compileTaskBrief(brief: TaskBrief, labels: TaskBriefPromptLabels): string {
  const title = brief.title.trim()
    || brief.cards.find((card) => card.kind === 'goal' && card.content.trim())?.content.trim().split('\n')[0]
    || labels.untitled;
  const blocks = [`# ${labels.task}: ${title}`, `## ${labels.project}\n${brief.projectPath.trim()}`];
  for (const section of SECTION_ORDER) {
    const cards = brief.cards.filter((card) => card.kind === section.kind && card.content.trim());
    if (cards.length === 0) continue;
    const body = section.checklist
      ? cards.map((card) => `- [ ] ${card.content.trim().replace(/\n+/g, '\n  ')}`).join('\n')
      : cards.map((card) => card.content.trim()).join('\n\n');
    blocks.push(`## ${labels.sections[section.kind]}\n${body}`);
  }
  const references = brief.references.filter((reference) => reference.label.trim() && reference.value.trim());
  if (references.length > 0) {
    blocks.push(`## ${labels.references}\n${references.map((reference) => `- [${reference.kind}] ${reference.label.trim()} - ${reference.value.trim()}`).join('\n')}`);
  }
  return `${blocks.join('\n\n')}\n`;
}
