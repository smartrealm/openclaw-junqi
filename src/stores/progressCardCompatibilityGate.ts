import {
  projectOpenClawLegacyProgressCard,
  type OpenClawLegacyProgressPlanUpdate,
  type OpenClawProgressCard,
} from '@/progress-card/domain';

export interface LegacyProgressCardProjection {
  readonly sessionKey: string;
  readonly card: OpenClawProgressCard | null;
}

type ProgressCardTransportMode = 'unknown' | 'durable' | 'legacy_stream';

/**
 * 只在真实 RPC 证明持久化方法不可用后发布官方旧计划流。
 * 暂存区绑定物理连接，避免探测竞态和重连后的旧事件污染当前会话。
 */
export class ProgressCardCompatibilityGate {
  private connectionId: string | null = null;
  private mode: ProgressCardTransportMode = 'unknown';
  private readonly pending = new Map<string, OpenClawLegacyProgressPlanUpdate>();
  private readonly revisions = new Map<string, number>();

  observeConnection(connectionId: string | null): void {
    if (this.connectionId === connectionId) return;
    this.connectionId = connectionId;
    this.mode = 'unknown';
    this.pending.clear();
    this.revisions.clear();
  }

  recordDurable(connectionId: string): void {
    this.observeConnection(connectionId);
    this.mode = 'durable';
    this.pending.clear();
  }

  recordLegacyStream(connectionId: string): readonly LegacyProgressCardProjection[] {
    this.observeConnection(connectionId);
    if (this.mode === 'durable') return [];
    this.mode = 'legacy_stream';
    const projections = [...this.pending.values()].map((update) => this.project(update));
    this.pending.clear();
    return projections;
  }

  receive(
    connectionId: string,
    update: OpenClawLegacyProgressPlanUpdate,
  ): LegacyProgressCardProjection | null {
    this.observeConnection(connectionId);
    if (this.mode === 'durable') return null;
    if (this.mode === 'unknown') {
      this.pending.set(update.sessionKey, update);
      return null;
    }
    return this.project(update);
  }

  clear(): void {
    this.connectionId = null;
    this.mode = 'unknown';
    this.pending.clear();
    this.revisions.clear();
  }

  private project(update: OpenClawLegacyProgressPlanUpdate): LegacyProgressCardProjection {
    const revision = (this.revisions.get(update.sessionKey) ?? 0) + 1;
    this.revisions.set(update.sessionKey, revision);
    return {
      sessionKey: update.sessionKey,
      card: projectOpenClawLegacyProgressCard(update, revision),
    };
  }
}
