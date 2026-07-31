import type { DecisionOption, FileRef, SessionEvent, WorkshopEvent } from '@/types/RenderBlock';
import type { ResponseGroup } from '@/types/ResponseGroup';
import type { ExecutionPlanSnapshot } from '@/agent-execution-plan/domain';

interface TraceNodeBase {
  id: string;
  sourceMessageId: string;
  timestamp: string;
  sourceSequence?: number;
}

export type ChatResponseTraceNode =
  | (TraceNodeBase & { kind: 'plan'; snapshot: ExecutionPlanSnapshot; snapshotNumber: number })
  | (TraceNodeBase & { kind: 'thinking'; content: string })
  | (TraceNodeBase & {
      kind: 'tool';
      toolName: string;
      toolCallId?: string;
      input?: Record<string, unknown>;
      output?: string;
      status: 'running' | 'done' | 'error';
      durationMs?: number;
      error?: string;
      outputTruncated?: boolean;
      outputOriginalLength?: number;
    })
  | (TraceNodeBase & { kind: 'review-request'; options: DecisionOption[] })
  | (TraceNodeBase & { kind: 'message'; role: 'user' | 'assistant'; characterCount: number })
  | (TraceNodeBase & { kind: 'file-output'; files: FileRef[] })
  | (TraceNodeBase & { kind: 'workshop-event'; events: WorkshopEvent[] })
  | (TraceNodeBase & { kind: 'session-event'; event: SessionEvent })
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

export function projectChatResponseTrace(group: ResponseGroup): ChatResponseTrace {
  let planSnapshotNumber = 0;
  const nodes = group.blocks.flatMap((block): ChatResponseTraceNode[] => {
    const base: TraceNodeBase = {
      id: block.id,
      sourceMessageId: block.sourceMessageId,
      timestamp: block.timestamp,
      ...(block.sourceSequence !== undefined ? { sourceSequence: block.sourceSequence } : {}),
    };

    switch (block.type) {
      case 'execution-plan':
        planSnapshotNumber += 1;
        return [{ ...base, kind: 'plan', snapshot: block.snapshot, snapshotNumber: planSnapshotNumber }];
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
      case 'message-content':
        return [{ ...base, kind: 'message', role: block.role, characterCount: block.markdown.length }];
      case 'file-output':
        return [{ ...base, kind: 'file-output', files: block.files }];
      case 'workshop-event':
        return [{ ...base, kind: 'workshop-event', events: block.events }];
      case 'session-event':
        return [{ ...base, kind: 'session-event', event: block.event }];
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
      case 'compaction':
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
