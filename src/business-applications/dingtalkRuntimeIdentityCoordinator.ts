import type { OpenClawToolsInvokeResult } from '@/services/gateway/OpenClawToolsInvokeClient';
import type { DingTalkRuntimeIdentityProjection } from './dingtalkTools';

export interface DingTalkRuntimeIdentityContext {
  readonly connectionId: string;
  readonly sessionKey: string;
  readonly toolsRevision: number;
}

export interface DingTalkRuntimeIdentitySnapshot {
  readonly contextKey: string;
  readonly toolsRevision: number;
  readonly phase: 'loading' | 'settled';
  readonly runtime: DingTalkRuntimeIdentityProjection | null;
  readonly error: string | null;
}

/**
 * 仅发布与当前连接、会话和有效工具快照完全一致的已结算身份，避免旧 Profile
 * 在工具策略刷新期间继续驱动目录或调用入口。
 */
export function selectCurrentDingTalkRuntimeIdentitySnapshot(
  snapshot: DingTalkRuntimeIdentitySnapshot | null,
  contextKey: string | null,
  toolsRevision: number,
): DingTalkRuntimeIdentitySnapshot | null {
  if (!snapshot || !contextKey || toolsRevision <= 0) return null;
  return snapshot.contextKey === contextKey
    && snapshot.toolsRevision === toolsRevision
    && snapshot.phase === 'settled'
    ? snapshot
    : null;
}

interface DingTalkRuntimeIdentityDependencies {
  readonly isContextCurrent: (context: DingTalkRuntimeIdentityContext) => boolean;
  readonly invokeRuntimeStatus: (sessionKey: string) => Promise<OpenClawToolsInvokeResult>;
  readonly parseRuntimeStatus: (result: OpenClawToolsInvokeResult) => DingTalkRuntimeIdentityProjection;
}

type SnapshotListener = () => void;

function normalizedContext(
  context: DingTalkRuntimeIdentityContext,
): DingTalkRuntimeIdentityContext | null {
  const connectionId = context.connectionId.trim();
  const sessionKey = context.sessionKey.trim();
  if (!connectionId || !sessionKey || !Number.isSafeInteger(context.toolsRevision) || context.toolsRevision <= 0) {
    return null;
  }
  return { connectionId, sessionKey, toolsRevision: context.toolsRevision };
}

export function createDingTalkRuntimeIdentityContextKey(
  connectionId: string,
  sessionKey: string,
): string | null {
  const normalizedConnectionId = connectionId.trim();
  const normalizedSessionKey = sessionKey.trim();
  return normalizedConnectionId && normalizedSessionKey
    ? `${normalizedConnectionId}\u0000${normalizedSessionKey}`
    : null;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DingTalkRuntimeIdentityCoordinator {
  private snapshot: DingTalkRuntimeIdentitySnapshot | null = null;
  private requestRevision = 0;
  private pending: {
    readonly contextKey: string;
    readonly toolsRevision: number;
    readonly promise: Promise<boolean>;
  } | null = null;
  private readonly listeners = new Set<SnapshotListener>();

  constructor(private readonly dependencies: DingTalkRuntimeIdentityDependencies) {}

  readonly getSnapshot = (): DingTalkRuntimeIdentitySnapshot | null => this.snapshot;

  readonly subscribe = (listener: SnapshotListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  invalidate(): void {
    this.requestRevision += 1;
    this.pending = null;
    if (this.snapshot === null) return;
    this.snapshot = null;
    this.emit();
  }

  invalidateContext(connectionId: string, sessionKey: string): void {
    const contextKey = createDingTalkRuntimeIdentityContextKey(connectionId, sessionKey);
    if (!contextKey || this.snapshot?.contextKey !== contextKey) return;
    this.invalidate();
  }

  refresh(context: DingTalkRuntimeIdentityContext, force = false): Promise<boolean> {
    const current = normalizedContext(context);
    if (!current || !this.dependencies.isContextCurrent(current)) {
      if (current) this.invalidateContext(current.connectionId, current.sessionKey);
      return Promise.resolve(false);
    }
    const contextKey = createDingTalkRuntimeIdentityContextKey(
      current.connectionId,
      current.sessionKey,
    );
    if (!contextKey) return Promise.resolve(false);

    if (
      !force
      && this.snapshot?.contextKey === contextKey
      && this.snapshot.toolsRevision === current.toolsRevision
      && this.snapshot.phase === 'settled'
    ) {
      return Promise.resolve(true);
    }
    if (
      this.pending?.contextKey === contextKey
      && this.pending.toolsRevision === current.toolsRevision
    ) {
      return this.pending.promise;
    }

    const requestRevision = ++this.requestRevision;
    this.snapshot = {
      contextKey,
      toolsRevision: current.toolsRevision,
      phase: 'loading',
      runtime: this.snapshot?.contextKey === contextKey ? this.snapshot.runtime : null,
      error: null,
    };
    this.emit();

    const promise = this.runRefresh(current, contextKey, requestRevision);
    this.pending = { contextKey, toolsRevision: current.toolsRevision, promise };
    return promise;
  }

  publish(
    context: DingTalkRuntimeIdentityContext,
    result: OpenClawToolsInvokeResult,
  ): boolean {
    const current = normalizedContext(context);
    if (!current || !this.dependencies.isContextCurrent(current) || !result.ok) return false;
    const contextKey = createDingTalkRuntimeIdentityContextKey(
      current.connectionId,
      current.sessionKey,
    );
    if (!contextKey) return false;
    this.requestRevision += 1;
    this.pending = null;
    this.snapshot = {
      contextKey,
      toolsRevision: current.toolsRevision,
      phase: 'settled',
      runtime: this.dependencies.parseRuntimeStatus(result),
      error: null,
    };
    this.emit();
    return true;
  }

  private async runRefresh(
    context: DingTalkRuntimeIdentityContext,
    contextKey: string,
    requestRevision: number,
  ): Promise<boolean> {
    try {
      const result = await this.dependencies.invokeRuntimeStatus(context.sessionKey);
      if (!result.ok) throw new Error(result.error?.message ?? 'DWS 身份读取失败');
      if (!this.isRequestCurrent(context, requestRevision)) return false;
      this.snapshot = {
        contextKey,
        toolsRevision: context.toolsRevision,
        phase: 'settled',
        runtime: this.dependencies.parseRuntimeStatus(result),
        error: null,
      };
      this.emit();
      return true;
    } catch (error) {
      if (!this.isRequestCurrent(context, requestRevision)) return false;
      this.snapshot = {
        contextKey,
        toolsRevision: context.toolsRevision,
        phase: 'settled',
        runtime: null,
        error: failureMessage(error),
      };
      this.emit();
      return false;
    } finally {
      if (this.pending?.promise && requestRevision === this.requestRevision) {
        this.pending = null;
      }
    }
  }

  private isRequestCurrent(
    context: DingTalkRuntimeIdentityContext,
    requestRevision: number,
  ): boolean {
    return requestRevision === this.requestRevision
      && this.dependencies.isContextCurrent(context);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }
}
