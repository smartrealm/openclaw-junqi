export const OPENCLAW_PROGRESS_CARD_MAX_MARKDOWN_BYTES = 8_192;
export const OPENCLAW_PROGRESS_CARD_MAX_STEPS = 50;
export const OPENCLAW_PROGRESS_CARD_MAX_STEP_BYTES = 512;

export type OpenClawProgressCardStepStatus = 'pending' | 'in_progress' | 'completed';

export interface OpenClawProgressCardStep {
  readonly id: string;
  readonly step: string;
  readonly status: OpenClawProgressCardStepStatus;
}

export interface OpenClawProgressCard {
  readonly id: string;
  readonly sessionKey: string;
  readonly revision: number;
  readonly updatedAt: number;
  readonly markdown?: string;
  readonly steps: readonly OpenClawProgressCardStep[];
}

export class OpenClawProgressCardResponseError extends Error {
  readonly code = 'OPENCLAW_PROGRESS_CARD_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid progress card response');
    this.name = 'OpenClawProgressCardResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function nonEmptyText(value: unknown, maximumBytes: number): string | null {
  if (typeof value !== 'string' || value.length === 0 || utf8Length(value) > maximumBytes) {
    return null;
  }
  return value;
}

function status(value: unknown): OpenClawProgressCardStepStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
    ? value
    : null;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function parseSteps(value: unknown): readonly OpenClawProgressCardStep[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > OPENCLAW_PROGRESS_CARD_MAX_STEPS) return null;
  const occurrences = new Map<string, number>();
  let inProgressCount = 0;
  const steps = value.map((candidate) => {
    const source = record(candidate);
    const step = nonEmptyText(source?.step, OPENCLAW_PROGRESS_CARD_MAX_STEP_BYTES);
    const stepStatus = status(source?.status);
    if (!step || !stepStatus) return null;
    if (stepStatus === 'in_progress') inProgressCount += 1;
    const occurrence = occurrences.get(step) ?? 0;
    occurrences.set(step, occurrence + 1);
    return {
      id: `step-${stableHash(`${step}\u0000${occurrence}`)}`,
      step,
      status: stepStatus,
    } satisfies OpenClawProgressCardStep;
  });
  return steps.some((step) => step === null) || inProgressCount > 1
    ? null
    : steps as readonly OpenClawProgressCardStep[];
}

export function parseOpenClawProgressCardResult(value: unknown): OpenClawProgressCard | null {
  const result = record(value);
  if (!result || !Object.prototype.hasOwnProperty.call(result, 'card')) {
    throw new OpenClawProgressCardResponseError();
  }
  if (result.card === null) return null;
  const source = record(result.card);
  const sessionKey = nonEmptyText(source?.sessionKey, 4_096);
  const revision = source?.revision;
  const updatedAt = source?.updatedAt;
  const markdown = source?.markdown;
  const steps = parseSteps(source?.steps);
  if (
    !source
    || !sessionKey
    || typeof revision !== 'number'
    || !Number.isSafeInteger(revision)
    || revision < 1
    || typeof updatedAt !== 'number'
    || !Number.isSafeInteger(updatedAt)
    || (markdown !== undefined && (
      typeof markdown !== 'string'
      || utf8Length(markdown) > OPENCLAW_PROGRESS_CARD_MAX_MARKDOWN_BYTES
    ))
    || !steps
  ) {
    throw new OpenClawProgressCardResponseError();
  }
  return {
    id: `progress-card-${stableHash(sessionKey)}`,
    sessionKey,
    revision,
    updatedAt,
    ...(markdown !== undefined ? { markdown } : {}),
    steps,
  };
}

export function currentOpenClawProgressCardStepIndex(card: OpenClawProgressCard): number {
  const inProgress = card.steps.findIndex((step) => step.status === 'in_progress');
  if (inProgress >= 0) return inProgress;
  const pending = card.steps.findIndex((step) => step.status === 'pending');
  if (pending >= 0) return pending;
  return Math.max(card.steps.length - 1, 0);
}
