import type { DingTalkEventConfiguration } from './dingtalkEventConfiguration';
import type { OpenClawDingTalkEventSnapshot } from '@/services/gateway/OpenClawDingTalkEventClient';

export interface DingTalkEventSnapshotReadContext {
  readonly connectionId: string;
  readonly runtimeGeneration: string | null;
  readonly invalidationConfigurationDigest: string | null;
  readonly configurationCanonical: string;
  readonly profileRef: string;
  readonly subscriptionCount: number;
  readonly eventKeys: readonly string[];
  readonly minimumRevision: number | null;
  readonly afterSequence: number;
  readonly key: string;
}

export interface DingTalkEventSnapshotRequest {
  readonly revision: number;
  readonly contextKey: string;
}

export class DingTalkEventSnapshotContextError extends Error {
  readonly code = 'OPENCLAW_DINGTALK_EVENT_SNAPSHOT_CONTEXT_MISMATCH';

  constructor() {
    super('钉钉事件快照与当前连接或已保存配置不一致');
    this.name = 'DingTalkEventSnapshotContextError';
  }
}

export function selectDingTalkEventConfigurationForConnection(
  configuration: DingTalkEventConfiguration | null,
  sourceConnectionId: string | null,
  currentConnectionId: string | null,
): DingTalkEventConfiguration | null {
  return configuration
    && sourceConnectionId
    && currentConnectionId
    && sourceConnectionId === currentConnectionId
    ? configuration
    : null;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function canonicalDingTalkEventConfiguration(
  configuration: DingTalkEventConfiguration,
): string {
  return JSON.stringify([
    configuration.profile || null,
    configuration.bufferSize,
    configuration.subscriptions.map((subscription) => [
      subscription.eventKeys,
      subscription.user ?? null,
      subscription.openDingTalkId ?? null,
      subscription.group ?? null,
      subscription.roleTypes?.length ? subscription.roleTypes : null,
    ]),
  ]);
}

export async function digestDingTalkEventConfiguration(
  configurationCanonical: string,
): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(configurationCanonical),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function createDingTalkEventSnapshotReadContext({
  connectionId,
  configuration,
  minimumRevision,
  runtimeGeneration,
  invalidationConfigurationDigest,
}: {
  connectionId: string;
  configuration: DingTalkEventConfiguration;
  minimumRevision: number | null;
  runtimeGeneration: string | null;
  invalidationConfigurationDigest: string | null;
}): DingTalkEventSnapshotReadContext | null {
  const normalizedConnectionId = connectionId.trim();
  if (
    !normalizedConnectionId
    || normalizedConnectionId !== connectionId
    || !configuration.enabled
    || !configuration.profile
    || (minimumRevision !== null && (
      !Number.isSafeInteger(minimumRevision)
      || minimumRevision < 1
    ))
    || (runtimeGeneration !== null
      && !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runtimeGeneration))
    || (invalidationConfigurationDigest !== null
      && !/^[a-f0-9]{64}$/u.test(invalidationConfigurationDigest))
    || (runtimeGeneration === null) !== (invalidationConfigurationDigest === null)
  ) return null;
  const eventKeys = uniqueSorted(configuration.subscriptions.flatMap(
    (subscription) => subscription.eventKeys,
  ));
  if (configuration.subscriptions.length < 1 || eventKeys.length < 1) return null;
  const afterSequence = minimumRevision === null ? 0 : Math.max(0, minimumRevision - 20);
  const configurationCanonical = canonicalDingTalkEventConfiguration(configuration);
  const key = JSON.stringify([
    normalizedConnectionId,
    configurationCanonical,
    runtimeGeneration,
    invalidationConfigurationDigest,
    minimumRevision,
  ]);
  return {
    connectionId: normalizedConnectionId,
    runtimeGeneration,
    invalidationConfigurationDigest,
    configurationCanonical,
    profileRef: configuration.profile,
    subscriptionCount: configuration.subscriptions.length,
    eventKeys,
    minimumRevision,
    afterSequence,
    key,
  };
}

/** 事件快照必须属于当前连接上的已保存配置，失效通知的修订也必须已经可读。 */
export function assertDingTalkEventSnapshotContext(
  snapshot: OpenClawDingTalkEventSnapshot,
  context: DingTalkEventSnapshotReadContext,
  expectedConfigurationDigest: string,
): void {
  const snapshotEventKeys = uniqueSorted(snapshot.eventKeys);
  if (
    !snapshot.configured
    || snapshot.configurationDigest !== expectedConfigurationDigest
    || (context.runtimeGeneration !== null
      && snapshot.runtimeGeneration !== context.runtimeGeneration)
    || snapshot.profileRef !== context.profileRef
    || snapshot.subscriptionCount !== context.subscriptionCount
    || snapshotEventKeys.length !== context.eventKeys.length
    || snapshotEventKeys.some((eventKey, index) => eventKey !== context.eventKeys[index])
    || (context.minimumRevision !== null && snapshot.latestSequence < context.minimumRevision)
  ) {
    throw new DingTalkEventSnapshotContextError();
  }
}

export class DingTalkEventSnapshotRequestCoordinator {
  private revision = 0;

  begin(context: DingTalkEventSnapshotReadContext): DingTalkEventSnapshotRequest {
    this.revision += 1;
    return { revision: this.revision, contextKey: context.key };
  }

  invalidate(): void {
    this.revision += 1;
  }

  accepts(
    request: DingTalkEventSnapshotRequest,
    context: DingTalkEventSnapshotReadContext | null,
  ): boolean {
    return request.revision === this.revision
      && context !== null
      && request.contextKey === context.key;
  }
}
