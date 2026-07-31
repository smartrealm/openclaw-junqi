import type {
  NormalizedMessage,
  NormalizedToolCall,
  NormalizedToolResult,
} from '@/types/NormalizedMessage';
import type {
  DecisionOption,
  FileRef,
  SessionEvent,
  WorkshopEvent,
} from '@/types/RenderBlock';
import { extractText } from './TextCleaner';
import {
  extractToolExecutionError,
  normalizeGatewayTimestamp,
  normalizeToolExecutionStatus,
  projectToolOutput,
  serializeToolOutput,
  type ToolOutputProjection,
  type ToolOutputProjectionOptions,
} from './toolExecutionProjection';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeToolInput(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return record ?? undefined;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function normalizeAttachments(value: unknown): NormalizedMessage['attachments'] {
  if (!Array.isArray(value)) return undefined;
  const attachments = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const mimeType = optionalText(record.mimeType);
    const content = typeof record.content === 'string' ? record.content : undefined;
    if (!mimeType || content === undefined) return [];
    const fileName = optionalText(record.fileName);
    return [{ mimeType, content, ...(fileName ? { fileName } : {}) }];
  });
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeFileRefs(value: unknown): FileRef[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const files = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const path = optionalText(record.path);
    if (!path) return [];
    const kind: FileRef['kind'] = record.kind === 'file' || record.kind === 'voice' || record.kind === 'path'
      ? record.kind
      : undefined;
    const meta = optionalText(record.meta);
    const workspaceRoot = optionalText(record.workspaceRoot);
    const relativePath = optionalText(record.relativePath);
    return [{
      path,
      ...(meta ? { meta } : {}),
      ...(kind ? { kind } : {}),
      ...(record.isCanonicalOutput === true ? { isCanonicalOutput: true } : {}),
      ...(workspaceRoot ? { workspaceRoot } : {}),
      ...(relativePath ? { relativePath } : {}),
    }];
  });
  return files.length > 0 ? files : undefined;
}

function normalizeDecisionOptions(value: unknown): DecisionOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((item) => {
    const record = asRecord(item);
    const text = record ? optionalText(record.text) : undefined;
    const optionValue = record ? optionalText(record.value) : undefined;
    return text && optionValue ? [{ text, value: optionValue }] : [];
  });
  return options.length > 0 ? options : undefined;
}

function normalizeWorkshopEvents(value: unknown): WorkshopEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events = value.flatMap((item) => {
    const record = asRecord(item);
    const kind = record ? optionalText(record.kind) : undefined;
    const text = record ? optionalText(record.text) : undefined;
    return kind && text ? [{ kind, text }] : [];
  });
  return events.length > 0 ? events : undefined;
}

function normalizeSessionEvents(value: unknown): SessionEvent[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const events = value.flatMap((item) => {
    const record = asRecord(item);
    const rawKind = record?.kind;
    const kind = isSessionEventKind(rawKind) ? rawKind : undefined;
    const text = record ? optionalText(record.text) : undefined;
    return kind && text ? [{ kind, text }] : [];
  });
  return events.length > 0 ? events : undefined;
}

function isSessionEventKind(value: unknown): value is SessionEvent['kind'] {
  return value === 'compaction'
    || value === 'fallback'
    || value === 'retry'
    || value === 'reset'
    || value === 'token-warning'
    || value === 'context-warning'
    || value === 'info';
}

function normalizeUsage(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const entries = Object.entries(record).flatMap(([key, rawValue]) => {
    const number = numberFromUnknown(rawValue);
    return number === undefined ? [] : [[key, number] as const];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractTextParts(content: unknown): string[] {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    const record = asRecord(content);
    if (!record) return [];
    const type = typeof record.type === 'string' ? record.type : '';
    if (type === 'thinking' || type === 'reasoning' || type === 'thought') {
      return [];
    }
    const directText = textFromUnknown(record.text) || textFromUnknown(record.content);
    return directText ? [directText] : [];
  }

  const parts: string[] = [];
  for (const item of content) {
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    const block = asRecord(item);
    if (!block) continue;
    const type = typeof block.type === 'string' ? block.type : '';
    if (
      type === 'thinking' ||
      type === 'reasoning' ||
      type === 'thought' ||
      type === 'toolCall' ||
      type === 'tool_use' ||
      type === 'toolcall' ||
      type === 'toolResult' ||
      type === 'tool_result' ||
      type === 'toolresult'
    ) {
      continue;
    }
    const text =
      textFromUnknown(block.text) ||
      textFromUnknown(block.content);
    if (text) {
      parts.push(text);
    }
  }
  return parts;
}

/**
 * Convert Gateway content into the plain-text contract used by ChatMessage.
 * Rich blocks remain available separately through ChatMessage.rawContent.
 */
export function extractGatewayMessageText(content: unknown): string {
  return extractTextParts(content).join('');
}

/** Exported for ChatHandler — live thinking from content blocks during streams. */
export function extractThinkingContent(content: unknown): string | undefined {
  const parts: string[] = [];

  if (!Array.isArray(content)) {
    const record = asRecord(content);
    const type = typeof record?.type === 'string' ? record.type : '';
    if (type === 'thinking' || type === 'reasoning' || type === 'thought') {
      const text =
        textFromUnknown(record?.thinking) ||
        textFromUnknown(record?.text) ||
        textFromUnknown(record?.content);
      if (text) parts.push(text);
    }
  } else {
    for (const item of content) {
      const block = asRecord(item);
      if (!block) continue;
      const type = typeof block.type === 'string' ? block.type : '';
      if (type !== 'thinking' && type !== 'reasoning' && type !== 'thought') {
        continue;
      }
      const text =
        textFromUnknown(block.thinking) ||
        textFromUnknown(block.text) ||
        textFromUnknown(block.content);
      if (text) {
        parts.push(text);
      }
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join('\n\n').trim() || undefined;
}

function extractToolCalls(content: unknown): NormalizedToolCall[] {
  if (!Array.isArray(content)) return [];
  const toolCalls: NormalizedToolCall[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    const type = typeof block.type === 'string' ? block.type : '';
    if (type !== 'toolCall' && type !== 'tool_use' && type !== 'toolcall') {
      continue;
    }
    const toolCallId = toolCallIdFromRecord(block);
    toolCalls.push({
      ...(toolCallId ? { toolCallId } : {}),
      name: textFromUnknown(block.name) || textFromUnknown(block.toolName) || 'unknown',
      input: normalizeToolInput(block.input ?? block.params ?? block.arguments),
    });
  }
  return toolCalls;
}

/**
 * Read structured tool-result blocks from a Gateway content array.
 *
 * History normalization uses this too, so a rich transcript record is never
 * reduced to a JSON representation of its enclosing content array.
 */
interface GatewayToolResultEntry {
  toolCallId?: string;
  name: string;
  result: unknown;
  isError: boolean;
}

function extractGatewayToolResultEntries(content: unknown): GatewayToolResultEntry[] {
  if (!Array.isArray(content)) return [];
  const toolResults: GatewayToolResultEntry[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (!block) continue;
    const type = typeof block.type === 'string' ? block.type : '';
    if (type !== 'toolResult' && type !== 'tool_result' && type !== 'toolresult') {
      continue;
    }
    const resultValue = block.result ?? block.output ?? block.content ?? block.text;
    const toolCallId = toolCallIdFromRecord(block);
    toolResults.push({
      ...(toolCallId ? { toolCallId } : {}),
      name: textFromUnknown(block.name) || textFromUnknown(block.toolName) || 'unknown',
      result: resultValue,
      isError: block.isError === true,
    });
  }
  return toolResults;
}

/** Read individual tool-result blocks for timeline and tool-card projection. */
export function extractGatewayToolResults(content: unknown): NormalizedToolResult[] {
  return extractGatewayToolResultEntries(content).map((entry) => {
    const projection = projectToolOutput(entry.result);
    return {
      ...(entry.toolCallId ? { toolCallId: entry.toolCallId } : {}),
      name: entry.name,
      text: projection?.text ?? extractText(entry.result ?? ''),
      ...(entry.isError ? { isError: true } : {}),
    };
  });
}

/**
 * Build one bounded output from a rich Gateway tool-result content array.
 * Serializing raw result values before the single display projection retains
 * the true combined length rather than losing it in per-item truncation.
 */
export function projectGatewayToolResultOutput(
  content: unknown,
  options: ToolOutputProjectionOptions = {},
): ToolOutputProjection | undefined {
  const entries = extractGatewayToolResultEntries(content);
  if (entries.length === 0) return undefined;
  return projectToolOutput(entries.map((entry) => serializeToolOutput(entry.result)).join('\n\n'), options);
}

/** Read an error supplied inside a structured result without inferring one. */
export function extractGatewayToolResultError(content: unknown): string | undefined {
  for (const entry of extractGatewayToolResultEntries(content)) {
    const error = extractToolExecutionError(entry.result);
    if (error) return error;
  }
  return undefined;
}

function toolCallIdFromRecord(block: Record<string, unknown>): string | undefined {
  return textFromUnknown(block.toolCallId)
    || textFromUnknown(block.tool_call_id)
    || textFromUnknown(block.id)
    || undefined;
}

export function normalizeGatewayMessage(message: unknown): NormalizedMessage {
  const source = asRecord(message) ?? {};
  const sessionKey =
    typeof source.sessionKey === 'string' && source.sessionKey.trim()
      ? source.sessionKey
      : 'agent:main:main';
  const runId =
    typeof source.runId === 'string' && source.runId.trim()
      ? source.runId
      : typeof source.run_id === 'string' && source.run_id.trim()
        ? source.run_id
        : null;
  const role = typeof source.role === 'string' ? source.role : 'unknown';
  const timestamp = normalizeGatewayTimestamp(source.timestamp ?? source.createdAt);
  const id = optionalText(source.id) || optionalText(source.messageId) || `hist-${crypto.randomUUID()}`;
  const rawContent = source.rawContent ?? source.content;
  const isStreaming = source.isStreaming === true;
  const responseState =
    source.responseState === 'error' || source.responseState === 'aborted'
      ? source.responseState
      : isStreaming
        ? 'streaming'
        : 'final';

  const textPartsRaw = extractTextParts(rawContent);
  const toolCalls = extractToolCalls(rawContent);
  const toolResults = extractGatewayToolResults(rawContent);
  const hasStructuredToolError = toolResults.some((result) => result.isError);
  const thinkingFromContent = extractThinkingContent(rawContent);
  // Preserve LLM text exactly; emoji/status glyphs are part of the model output.
  const text = textPartsRaw.join('');

  const contentBlocks = Array.isArray(rawContent)
    ? rawContent.filter((item) => asRecord(item))
    : [];
  const hasOnlyToolCallContent = contentBlocks.length > 0 && toolCalls.length === contentBlocks.length;
  const hasOnlyToolContent =
    contentBlocks.length > 0 &&
    contentBlocks.every((item) => {
      const block = asRecord(item);
      const type = typeof block?.type === 'string' ? block.type : '';
      return (
        type === 'toolCall' ||
        type === 'tool_use' ||
        type === 'toolcall' ||
        type === 'toolResult' ||
        type === 'tool_result' ||
        type === 'toolresult'
      );
    });

  const explicitToolOutput = firstDefined(source.toolOutput, source.output, source.result);
  const projectionOptions = {
    truncated: source.toolOutputTruncated,
    originalLength: source.toolOutputOriginalLength,
  };
  const toolOutput = explicitToolOutput !== undefined
    ? projectToolOutput(explicitToolOutput, projectionOptions)
    : projectGatewayToolResultOutput(rawContent, projectionOptions);
  const declaredToolStatus = normalizeToolExecutionStatus(
    source.toolStatus ?? source.status,
    source.isError === true || hasStructuredToolError,
  );
  const isToolResult = role === 'toolResult' || role === 'tool';
  const toolStatus = isToolResult
    ? declaredToolStatus ?? (source.isError === true || hasStructuredToolError ? 'error' : 'done')
    : declaredToolStatus;
  const explicitToolError = extractToolExecutionError(
    source.toolError ?? source.toolErrorSummary ?? source.error,
  );
  const resultToolError = toolStatus === 'error'
    ? explicitToolOutput !== undefined
      ? extractToolExecutionError(explicitToolOutput)
      : extractGatewayToolResultError(rawContent)
    : undefined;
  const formalReviewId = optionalText(source.formalReviewId);

  return {
    id,
    sessionKey,
    runId,
    role,
    kind: optionalText(source.kind),
    timestamp,
    model: typeof source.model === 'string' ? source.model : null,
    mediaUrl: optionalText(source.mediaUrl),
    mediaType: optionalText(source.mediaType),
    isStreaming,
    responseState,
    attachments: normalizeAttachments(source.attachments),
    toolCallId: optionalText(source.toolCallId) || optionalText(source.tool_call_id),
    toolName: optionalText(source.toolName) || optionalText(source.name),
    toolInput: normalizeToolInput(source.toolInput) ?? normalizeToolInput(source.input),
    toolOutput: toolOutput?.text,
    toolStatus,
    toolDurationMs: numberFromUnknown(
      source.toolDurationMs ?? source.durationMs ?? source.duration_ms ?? source.tool_duration_ms,
    ),
    ...(explicitToolError ?? resultToolError ? { toolError: explicitToolError ?? resultToolError } : {}),
    ...(toolOutput?.truncated
      ? {
          toolOutputTruncated: true,
          toolOutputOriginalLength: toolOutput.originalLength,
        }
      : {}),
    ...(formalReviewId
      ? { formalReviewId }
      : {}),
    sourceSequence: numberFromUnknown(source.nativeSequence ?? source.sourceSequence ?? source.seq),
    thinkingContent: optionalText(source.thinkingContent) ?? thinkingFromContent,
    fileRefs: normalizeFileRefs(source.fileRefs),
    decisionOptions: normalizeDecisionOptions(source.decisionOptions),
    workshopEvents: normalizeWorkshopEvents(source.workshopEvents),
    sessionEvents: normalizeSessionEvents(source.sessionEvents),
    usage: normalizeUsage(source.usage),
    text,
    textParts: textPartsRaw,
    toolCalls,
    toolResults,
    hasOnlyToolCallContent,
    hasOnlyToolContent,
    rawContent,
  };
}
