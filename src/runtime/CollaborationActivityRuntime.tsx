import { useEffect, useState } from 'react';
import { COLLABORATION_PLUGIN_BUNDLE } from '@/services/collaboration/bundledPlugin';
import { collaborationCapabilityIssue } from '@/services/collaboration/capabilityContract';
import {
  bindCollaborationRuntimeIdentity,
  getCurrentRuntimeIdentity,
  subscribeRuntimeIdentity,
} from '@/services/gateway/runtimeIdentity';
import { useChatStore } from '@/stores/chatStore';
import { useCollaborationStore } from '@/stores/collaborationStore';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

const GLOBAL_ACTIVITY_SYNC_INTERVAL_MS = 15_000;
const NEEDS_YOU_STATUSES = new Set([
  'AWAITING_APPROVAL',
  'AWAITING_INTERVENTION',
  'DELIVERY_PENDING',
]);

/**
 * 让协作投影在 Chat 外保持可用。插件拥有状态与历史，
 * 本组件只为活动中心和 Chat 历史抽屉装载只读投影。
 */
export function CollaborationActivityRuntime() {
  const connected = useChatStore((state) => state.connected);
  const bootstrap = useCollaborationStore((state) => state.bootstrap);
  const syncGlobalRuns = useCollaborationStore((state) => state.syncGlobalRuns);
  const syncTombstones = useCollaborationStore((state) => state.syncTombstones);
  const refreshRun = useCollaborationStore((state) => state.refreshRun);
  const startChangedHintSubscription = useCollaborationStore((state) => state.startChangedHintSubscription);
  const reset = useCollaborationStore((state) => state.reset);
  const [identity, setIdentity] = useState<RuntimeIdentity | null>(getCurrentRuntimeIdentity);

  useEffect(() => subscribeRuntimeIdentity(setIdentity), []);

  useEffect(() => {
    const connectionId = identity?.connectionId ?? null;
    if (!connected || !identity?.verified || !connectionId) {
      if (useCollaborationStore.getState().capabilities) reset();
      return;
    }

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: Promise<void> | null = null;
    let didBootstrap = false;
    let unsubscribeHints: (() => void) | undefined;

    const sync = async (): Promise<void> => {
      if (!active || inFlight) return inFlight ?? undefined;
      inFlight = (async () => {
        try {
          const currentCapabilities = await bootstrap(!didBootstrap);
          didBootstrap = true;
          if (!active) return;
          const boundIdentity = bindCollaborationRuntimeIdentity(
            currentCapabilities.collaborationInstanceId,
            connectionId,
          );
          if (!boundIdentity?.verified || boundIdentity.connectionId !== connectionId) return;
          if (collaborationCapabilityIssue(currentCapabilities, COLLABORATION_PLUGIN_BUNDLE)) return;
          unsubscribeHints ??= startChangedHintSubscription();

          const [runs] = await Promise.all([
            syncGlobalRuns({ includeArchived: true }),
            syncTombstones(),
          ]);
          if (!active) return;
          await Promise.allSettled(
            runs
              .filter((run) => NEEDS_YOU_STATUSES.has(run.status))
              .map((run) => refreshRun(run.runId)),
          );
        } catch {
          // Activity Center remains usable with its other projections. The
          // next event hint or scheduled cycle retries the authoritative read.
        } finally {
          inFlight = null;
        }
      })();
      return inFlight;
    };

    const schedule = () => {
      if (!active) return;
      timer = setTimeout(() => {
        void sync().finally(schedule);
      }, GLOBAL_ACTIVITY_SYNC_INTERVAL_MS);
    };

    void sync().finally(schedule);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribeHints?.();
    };
  }, [bootstrap, connected, identity?.connectionId, identity?.verified, refreshRun, reset, startChangedHintSubscription, syncGlobalRuns, syncTombstones]);

  return null;
}

export default CollaborationActivityRuntime;
