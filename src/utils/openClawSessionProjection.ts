import { projectOpenClawSession } from '@/services/gateway/OpenClawSessionProjection';
import { parseOpenClawActiveLeafEntryId } from '@/services/gateway/activeLeafEntryId';
import { resolveGatewaySessionModelId } from '@/services/gateway/modelIdentity';
import { parseGatewaySessionAbortedLastRun } from '@/services/gateway/sessionAbortedLastRun';
import { parseGatewaySessionAgentRuntime } from '@/services/gateway/sessionAgentRuntime';
import { parseGatewaySessionAgentStatus } from '@/services/gateway/sessionAgentStatus';
import { parseGatewaySessionContextBudgetStatus } from '@/services/gateway/sessionContextBudgetStatus';
import { parseGatewaySessionGoal } from '@/services/gateway/sessionGoal';
import { parseGatewaySessionLastRunError } from '@/services/gateway/sessionLastRunError';
import { parseGatewaySessionThinkingProfile } from '@/services/gateway/sessionThinkingProfile';
import type { Session } from '@/stores/chatStore';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function boolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function origin(value: unknown): Session['origin'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const projected: NonNullable<Session['origin']> = {};
  const stringFields = ['label', 'provider', 'surface', 'chatType', 'from', 'to', 'nativeChannelId', 'nativeDirectUserId', 'accountId'] as const;
  for (const field of stringFields) {
    const parsed = text(source[field]);
    if (parsed) projected[field] = parsed;
  }
  if (typeof source.threadId === 'string' || typeof source.threadId === 'number') {
    projected.threadId = source.threadId;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

export function projectOpenClawSessionForChat(value: unknown): Session {
  const source = projectOpenClawSession(value);
  const thinking = parseGatewaySessionThinkingProfile(source);
  const activeLeafEntryId = parseOpenClawActiveLeafEntryId(source.activeLeafEntryId);
  const model = resolveGatewaySessionModelId(source.modelProvider, source.model);
  const category = text(source.category);
  const channel = text(source.channel) ?? text(source.lastChannel) ?? null;
  const lastChannel = text(source.lastChannel) ?? null;
  const parsedOrigin = origin(source.origin);
  const fastMode = source.fastMode === true || source.fastMode === false || source.fastMode === 'auto'
    ? source.fastMode
    : null;
  const verboseLevel = source.verboseLevel === 'on' || source.verboseLevel === 'full' || source.verboseLevel === 'off'
    ? source.verboseLevel
    : null;
  const reasoningLevel = source.reasoningLevel === 'on' || source.reasoningLevel === 'off' || source.reasoningLevel === 'stream'
    ? source.reasoningLevel
    : null;
  return {
    key: source.key,
    sessionId: source.sessionId,
    agentId: source.agentId,
    label: source.label ?? '',
    displayName: source.displayName,
    derivedTitle: source.derivedTitle,
    lastMessagePreview: source.lastMessagePreview,
    lastMessage: source.lastMessagePreview,
    lastTimestamp: number(source.lastActivityAt) ?? number(source.updatedAt),
    createdAt: number(source.createdAt),
    category: category ?? null,
    ...(category ? { groupId: category } : {}),
    kind: text(source.kind),
    channel,
    lastChannel,
    ...(parsedOrigin ? { origin: parsedOrigin } : {}),
    spawnedBy: text(source.spawnedBy),
    parentSessionKey: text(source.parentSessionKey),
    status: text(source.status),
    agentStatus: parseGatewaySessionAgentStatus(source.agentStatus),
    abortedLastRun: parseGatewaySessionAbortedLastRun(source.abortedLastRun),
    contextBudgetStatus: parseGatewaySessionContextBudgetStatus(source.contextBudgetStatus),
    goal: parseGatewaySessionGoal(source.goal),
    lastRunError: parseGatewaySessionLastRunError(source.lastRunError),
    ...(activeLeafEntryId !== undefined ? { activeLeafEntryId } : {}),
    hasActiveRun: boolean(source.hasActiveRun),
    hasActiveSubagentRun: boolean(source.hasActiveSubagentRun),
    subagentRunState: text(source.subagentRunState),
    systemSent: source.systemSent === true,
    model,
    modelSelectionLocked: source.modelSelectionLocked === true,
    agentRuntime: parseGatewaySessionAgentRuntime(source.agentRuntime),
    thinkingLevel: thinking.level,
    thinkingLevels: thinking.levels,
    thinkingDefault: thinking.defaultLevel,
    fastMode,
    verboseLevel,
    traceLevel: text(source.traceLevel) ?? null,
    responseUsage: text(source.responseUsage) ?? null,
    reasoningLevel,
    totalTokens: number(source.totalTokens),
    contextTokens: number(source.contextTokens),
    compactionCount: number(source.compactionCount),
    running: boolean(source.running) ?? false,
    pinned: source.pinned,
    archived: source.archived,
    unread: source.unread === true ? 1 : 0,
  };
}

