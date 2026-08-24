import type { DecisionOption, FileRef, SessionEvent, WorkshopEvent } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import type { MessageSemanticBlock } from '@/types/SemanticBlock';
import type { ChatMessage } from '@/stores/chatStore';

interface TraceNodeBase {
  id: string;
  sourceMessageId: string;
  timestamp: string;
  sourceSequence?: number;
}

export interface ChatResponseTraceContext {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  contextPercent?: number;
  model?: string;
}

export type ChatResponseTraceAuditStatus =
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'blocked'
  | 'unknown';

export interface ChatResponseTraceAuditEvent {
  eventType?: 'agent_run' | 'tool_action' | 'inbound_message' | 'outbound_message';
  eventId: string;
  sequence: number;
  sourceSequence: number;
  occurredAt: number;
  kind: 'agent_run' | 'tool_action' | 'message';
  action: string;
  status: ChatResponseTraceAuditStatus;
  actor: { type: string; id: string };
  redaction: 'metadata_only';
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  direction?: 'inbound' | 'outbound';
  channel?: string;
  conversationKind?: 'direct' | 'group' | 'channel' | 'unknown';
  outcome?: string;
  reasonCode?: string;
  errorCode?: string;
  failureStage?: 'platform_send' | 'queue' | 'unknown';
  deliveryKind?: 'text' | 'media' | 'other';
  durationMs?: number;
  resultCount?: number;
}

export interface ChatResponseTraceAuditPage {
  events: readonly ChatResponseTraceAuditEvent[];
  nextCursor?: string;
  source: 'activity';
}

export type ChatResponseTraceNode =
  | (TraceNodeBase & { kind: 'thinking'; content: string })
  | (TraceNodeBase & {
      kind: 'tool';
      toolName: string;
      toolCallId?: string;
      input?: Record<string, unknown>;
      output?: string;
      status: 'running' | 'done' | 'error' | 'cancelled' | 'verification_required';
      durationMs?: number;
      error?: string;
      outputTruncated?: boolean;
      outputOriginalLength?: number;
    })
  | (TraceNodeBase & { kind: 'review-request'; options: DecisionOption[] })
  | (TraceNodeBase & {
      kind: 'message';
      role: 'user' | 'assistant';
      characterCount: number;
      context?: ChatResponseTraceContext;
    })
  | (TraceNodeBase & { kind: 'file-output'; files: FileRef[] })
  | (TraceNodeBase & { kind: 'workshop-event'; events: WorkshopEvent[] })
  | (TraceNodeBase & { kind: 'session-event'; event: SessionEvent })
  | (TraceNodeBase & { kind: 'compaction' })
  | (TraceNodeBase & { kind: 'action'; actions: Array<{ text: string; callbackData: string }> })
  | (TraceNodeBase & { kind: 'artifact'; artifactType: string; title: string });

export interface ChatResponseTrace {
  id: string;
  authority: 'openclaw-run' | 'gateway-transcript';
  sessionKey: string;
  runId: string | null;
  status: ResponseGroup['status'];
  startedAt: number;
  completedAt?: number;
  sourceMessageIds: string[];
  nodes: ChatResponseTraceNode[];
  review: {
    status: 'not-requested' | 'requested';
    recording: 'none' | 'transcript-only';
    requestCount: number;
    formalReviewId?: string;
  };
}

/** Finds the already loaded transcript record without treating a local display id as a Gateway id. */
export function findTraceSourceMessage(
  messages: readonly ChatMessage[],
  sourceMessageId: string,
): ChatMessage | undefined {
  return messages.find((message) => (
    message.nativeMessageId === sourceMessageId || message.id === sourceMessageId
  ));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function contextFromMeta(meta: MessageSemanticBlock['meta']): ChatResponseTraceContext | undefined {
  const context = meta?.find((item) => item.kind === 'context');
  if (!context) return undefined;
  try {
    const parsed: unknown = JSON.parse(context.content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const input = positiveNumber(record.input);
    const output = positiveNumber(record.output);
    const cacheRead = positiveNumber(record.cacheRead);
    const cacheWrite = positiveNumber(record.cacheWrite);
    const contextPercent = finiteNumber(record.contextPercent);
    const model = typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : undefined;
    if (input === undefined && output === undefined && cacheRead === undefined
      && cacheWrite === undefined && contextPercent === undefined && !model) {
      return undefined;
    }
    return {
      ...(input !== undefined ? { input } : {}),
      ...(output !== undefined ? { output } : {}),
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
      ...(contextPercent !== undefined ? { contextPercent } : {}),
      ...(model ? { model } : {}),
    };
  } catch {
    return undefined;
  }
}

export function projectChatResponseTrace(group: ResponseGroup): ChatResponseTrace {
  const nodes = group.blocks.flatMap((block): ChatResponseTraceNode[] => {
    const base: TraceNodeBase = {
      id: block.id,
      sourceMessageId: block.sourceMessageId,
      timestamp: block.timestamp,
      ...(block.sourceSequence !== undefined ? { sourceSequence: block.sourceSequence } : {}),
    };

    switch (block.type) {
      case 'thinking':
        return [{ ...base, kind: 'thinking', content: block.content }];
      case 'tool-activity':
        return [{
          ...base,
          kind: 'tool',
          toolName: block.toolName,
          ...(block.toolCallId ? { toolCallId: block.toolCallId } : {}),
          ...(block.input ? { input: block.input } : {}),
          ...(block.output !== undefined ? { output: block.output } : {}),
          status: block.status,
          ...(block.durationMs !== undefined ? { durationMs: block.durationMs } : {}),
          ...(block.error ? { error: block.error } : {}),
          ...(block.outputTruncated ? { outputTruncated: true } : {}),
          ...(block.outputOriginalLength !== undefined
            ? { outputOriginalLength: block.outputOriginalLength }
            : {}),
        }];
      case 'decision':
        return [{ ...base, kind: 'review-request', options: block.options }];
      case 'message-content': {
        const context = contextFromMeta(block.meta);
        return [{
          ...base,
          kind: 'message',
          role: block.role,
          characterCount: block.markdown.length,
          ...(context ? { context } : {}),
        }];
      }
      case 'file-output':
        return [{ ...base, kind: 'file-output', files: block.files }];
      case 'workshop-event':
        return [{ ...base, kind: 'workshop-event', events: block.events }];
      case 'session-event':
        return [{ ...base, kind: 'session-event', event: block.event }];
      case 'compaction':
        return [{ ...base, kind: 'compaction' }];
      case 'inline-buttons':
        return [{
          ...base,
          kind: 'action',
          actions: block.rows.flatMap((row) => row.buttons.map((button) => ({
            text: button.text,
            callbackData: button.callback_data,
          }))),
        }];
      case 'artifact':
        return [{
          ...base,
          kind: 'artifact',
          artifactType: block.artifact.type,
          title: block.artifact.title,
        }];
      case 'system-note':
        return [];
    }
  });
  const requestCount = nodes.filter((node) => node.kind === 'review-request').length;
  const formalReviewIds = new Set(
    group.blocks
      .filter((block) => block.type === 'decision')
      .flatMap((block) => block.formalReviewId ? [block.formalReviewId] : []),
  );
  const formalReviewId = formalReviewIds.size === 1
    ? [...formalReviewIds][0]
    : undefined;

  return {
    id: group.id,
    authority: group.runId ? 'openclaw-run' : 'gateway-transcript',
    sessionKey: group.sessionKey,
    runId: group.runId ?? null,
    status: group.status,
    startedAt: group.startedAt,
    ...(group.completedAt !== undefined ? { completedAt: group.completedAt } : {}),
    sourceMessageIds: [...group.sourceMessageIds],
    nodes,
    review: requestCount > 0
      ? {
          status: 'requested',
          recording: 'transcript-only',
          requestCount,
          ...(formalReviewId ? { formalReviewId } : {}),
        }
      : { status: 'not-requested', recording: 'none', requestCount: 0 },
  };
}
