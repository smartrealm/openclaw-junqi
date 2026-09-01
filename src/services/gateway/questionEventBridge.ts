import {
  parseOpenClawPendingQuestion,
  type OpenClawPendingQuestion,
  type OpenClawQuestionResolvedStatus,
} from './OpenClawQuestionClient';

export type GatewayQuestionEvent =
  | { readonly phase: 'requested'; readonly question: OpenClawPendingQuestion }
  | { readonly phase: 'resolved'; readonly id: string; readonly status: OpenClawQuestionResolvedStatus };

export type GatewayQuestionEventListener = (event: GatewayQuestionEvent) => void;

const listeners = new Set<GatewayQuestionEventListener>();

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseGatewayQuestionEvent(message: unknown): GatewayQuestionEvent | null {
  const envelope = record(message);
  if (!envelope || envelope.type !== 'event') return null;
  if (envelope.event === 'question.requested') {
    const question = parseOpenClawPendingQuestion(envelope.payload);
    return question ? { phase: 'requested', question } : null;
  }
  if (envelope.event !== 'question.resolved') return null;
  const payload = record(envelope.payload);
  const id = typeof payload?.id === 'string' ? payload.id : '';
  const status = payload?.status;
  if (!id || (status !== 'answered' && status !== 'cancelled' && status !== 'expired')) return null;
  return { phase: 'resolved', id, status };
}

export function publishGatewayQuestionEvent(message: unknown): boolean {
  const event = parseGatewayQuestionEvent(message);
  if (!event) return false;
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch {
      // 单个问题界面失败不能阻断同一权限连接上的后续事件。
    }
  }
  return true;
}

export function subscribeGatewayQuestionEvents(listener: GatewayQuestionEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
