import { useSyncExternalStore } from 'react';
import {
  DingTalkRuntimeIdentityCoordinator,
  type DingTalkRuntimeIdentityContext,
} from '@/business-applications/dingtalkRuntimeIdentityCoordinator';
import {
  DINGTALK_RUNTIME_STATUS_TOOL,
  hasAvailableDingTalkRuntimeTool,
  parseDingTalkRuntimeOutput,
} from '@/business-applications/dingtalkTools';
import { getCurrentRuntimeIdentity } from '@/services/gateway/runtimeIdentity';
import type { OpenClawToolsInvokeResult } from '@/services/gateway/OpenClawToolsInvokeClient';
import { invokeOpenClawTool, useGatewayDataStore } from './gatewayDataStore';

function isContextCurrent(context: DingTalkRuntimeIdentityContext): boolean {
  const identity = getCurrentRuntimeIdentity();
  if (!identity?.verified || identity.connectionId !== context.connectionId) return false;
  const state = useGatewayDataStore.getState();
  return state.sessions.some((session) => session.key === context.sessionKey)
    && state.toolsEffectiveUpdatedAt[context.sessionKey] === context.toolsRevision
    && hasAvailableDingTalkRuntimeTool(state.toolsEffective[context.sessionKey]?.groups);
}

const coordinator = new DingTalkRuntimeIdentityCoordinator({
  isContextCurrent,
  invokeRuntimeStatus: (sessionKey) => invokeOpenClawTool({
    name: DINGTALK_RUNTIME_STATUS_TOOL,
    sessionKey,
    args: {},
  }),
  parseRuntimeStatus: parseDingTalkRuntimeOutput,
});

export function currentDingTalkRuntimeIdentityContext(
  connectionId: string,
  sessionKey: string,
): DingTalkRuntimeIdentityContext | null {
  const normalizedConnectionId = connectionId.trim();
  const normalizedSessionKey = sessionKey.trim();
  const toolsRevision = useGatewayDataStore.getState().toolsEffectiveUpdatedAt[normalizedSessionKey] ?? 0;
  if (!normalizedConnectionId || !normalizedSessionKey || toolsRevision <= 0) return null;
  return {
    connectionId: normalizedConnectionId,
    sessionKey: normalizedSessionKey,
    toolsRevision,
  };
}

export function refreshDingTalkRuntimeIdentitySnapshot(
  connectionId: string,
  sessionKey: string,
  force = false,
): Promise<boolean> {
  const context = currentDingTalkRuntimeIdentityContext(connectionId, sessionKey);
  if (!context) {
    coordinator.invalidateContext(connectionId, sessionKey);
    return Promise.resolve(false);
  }
  return coordinator.refresh(context, force);
}

export function publishDingTalkRuntimeIdentityResult(
  connectionId: string,
  sessionKey: string,
  result: OpenClawToolsInvokeResult,
): boolean {
  const context = currentDingTalkRuntimeIdentityContext(connectionId, sessionKey);
  return context ? coordinator.publish(context, result) : false;
}

export function invalidateDingTalkRuntimeIdentitySnapshot(): void {
  coordinator.invalidate();
}

export function invalidateDingTalkRuntimeIdentityContext(
  connectionId: string,
  sessionKey: string,
): void {
  coordinator.invalidateContext(connectionId, sessionKey);
}

export function useDingTalkRuntimeIdentitySnapshot() {
  return useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    () => null,
  );
}
