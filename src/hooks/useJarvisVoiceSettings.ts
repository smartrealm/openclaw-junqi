import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway, talkGatewayClient, voiceWakeGatewayClient } from '@/services/gateway';
import { VoiceWakeGatewayUnavailableError } from '@/services/gateway/VoiceWakeGatewayClient';
import type { VoiceWakeRoutingConfig } from '@/types/voiceWake';
import { subscribeVoiceWakeSettingsProjection } from '@/services/voice/VoiceWakeSettingsProjection';
import { debugError } from '@/utils/debugLog';
import { JarvisVoiceSettingsOperationGate } from './JarvisVoiceSettingsOperationGate';

export type JarvisVoiceSettingsError =
  | 'gateway_unavailable'
  | 'invalid_response'
  | 'request_failed';

export interface JarvisVoiceSettingsState {
  gatewayTriggers: string[];
  routing: VoiceWakeRoutingConfig | null;
  loading: boolean;
  savingTriggers: boolean;
  savingRouting: boolean;
  triggerError: JarvisVoiceSettingsError | null;
  routingError: JarvisVoiceSettingsError | null;
  talkReady: boolean | null;
  talkProvider: string | null;
  talkError: JarvisVoiceSettingsError | null;
  refresh: () => Promise<void>;
  saveTriggers: (triggers: readonly string[]) => Promise<boolean>;
  saveRouting: (routing: VoiceWakeRoutingConfig) => Promise<boolean>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function settingsError(error: unknown): JarvisVoiceSettingsError {
  if (error instanceof VoiceWakeGatewayUnavailableError) {
    return error.reason === 'invalid_response' ? 'invalid_response' : 'gateway_unavailable';
  }
  return 'request_failed';
}

function cloneRouting(routing: VoiceWakeRoutingConfig): VoiceWakeRoutingConfig {
  return {
    ...routing,
    defaultTarget: { ...routing.defaultTarget },
    routes: routing.routes.map((route) => ({
      trigger: route.trigger,
      target: { ...route.target },
    })),
  };
}

/** 独立读取 OpenClaw 的全局触发词和路由，使单项能力失败时另一项仍可使用。 */
export function useJarvisVoiceSettings(enabled: boolean): JarvisVoiceSettingsState {
  const [gatewayTriggers, setGatewayTriggers] = useState<string[]>([]);
  const [routing, setRouting] = useState<VoiceWakeRoutingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingTriggers, setSavingTriggers] = useState(false);
  const [savingRouting, setSavingRouting] = useState(false);
  const [triggerError, setTriggerError] = useState<JarvisVoiceSettingsError | null>(null);
  const [routingError, setRoutingError] = useState<JarvisVoiceSettingsError | null>(null);
  const [talkReady, setTalkReady] = useState<boolean | null>(null);
  const [talkProvider, setTalkProvider] = useState<string | null>(null);
  const [talkError, setTalkError] = useState<JarvisVoiceSettingsError | null>(null);
  const operationGateRef = useRef(new JarvisVoiceSettingsOperationGate());
  const triggerSaveRef = useRef<Promise<boolean> | null>(null);
  const routingSaveRef = useRef<Promise<boolean> | null>(null);

  const replaceTriggers = useCallback((triggers: readonly string[]) => {
    operationGateRef.current.invalidateData();
    setGatewayTriggers([...triggers]);
    setTriggerError(null);
  }, []);

  const replaceRouting = useCallback((next: VoiceWakeRoutingConfig) => {
    operationGateRef.current.invalidateData();
    setRouting(cloneRouting(next));
    setRoutingError(null);
  }, []);

  const refresh = useCallback(async () => {
    const token = operationGateRef.current.beginRefresh();
    setLoading(true);
    setTriggerError(null);
    setRoutingError(null);
    setTalkError(null);
    setTalkReady(null);
    setTalkProvider(null);
    const connectionId = gateway.captureConnectionId();
    const [triggerResult, routingResult] = await Promise.allSettled([
      voiceWakeGatewayClient.getTriggers(),
      voiceWakeGatewayClient.getRouting(),
    ]);
    const talkClient = connectionId ? talkGatewayClient.bindConnection(connectionId) : null;
    const talkResult = talkClient
      ? await Promise.allSettled([talkClient.getCatalog()]).then(([result]) => result)
      : { status: 'rejected' as const, reason: new Error('Gateway Talk catalog is unavailable') };
    if (operationGateRef.current.canCommit(token)) {
      if (triggerResult.status === 'fulfilled') setGatewayTriggers([...triggerResult.value.triggers]);
      else {
        debugError('gateway', '[JarvisVoiceSettings] 读取唤醒词失败：', errorMessage(triggerResult.reason));
        setTriggerError(settingsError(triggerResult.reason));
      }
      if (routingResult.status === 'fulfilled') setRouting(cloneRouting(routingResult.value));
      else {
        debugError('gateway', '[JarvisVoiceSettings] 读取唤醒路由失败：', errorMessage(routingResult.reason));
        setRoutingError(settingsError(routingResult.reason));
      }
      if (talkResult.status === 'fulfilled') {
        setTalkReady(talkResult.value.realtime.ready === true);
        setTalkProvider(talkResult.value.realtime.activeProvider ?? null);
      } else {
        setTalkReady(null);
        setTalkProvider(null);
        setTalkError(settingsError(talkResult.reason));
      }
    }
    if (operationGateRef.current.isLatest(token)) setLoading(false);
  }, []);

  const saveTriggers = useCallback((triggers: readonly string[]): Promise<boolean> => {
    if (triggerSaveRef.current) return triggerSaveRef.current;
    operationGateRef.current.invalidateData();
    setSavingTriggers(true);
    setTriggerError(null);
    const operation = (async () => {
      try {
        const snapshot = await voiceWakeGatewayClient.setTriggers(triggers);
        replaceTriggers(snapshot.triggers);
        return true;
      } catch (cause) {
        debugError('gateway', '[JarvisVoiceSettings] 保存唤醒词失败：', errorMessage(cause));
        setTriggerError(settingsError(cause));
        return false;
      }
    })();
    triggerSaveRef.current = operation;
    void operation.then(() => {
      if (triggerSaveRef.current === operation) {
        triggerSaveRef.current = null;
        setSavingTriggers(false);
      }
    });
    return operation;
  }, [replaceTriggers]);

  const saveRouting = useCallback((next: VoiceWakeRoutingConfig): Promise<boolean> => {
    if (routingSaveRef.current) return routingSaveRef.current;
    operationGateRef.current.invalidateData();
    setSavingRouting(true);
    setRoutingError(null);
    const operation = (async () => {
      try {
        replaceRouting(await voiceWakeGatewayClient.setRouting(next));
        return true;
      } catch (cause) {
        debugError('gateway', '[JarvisVoiceSettings] 保存唤醒路由失败：', errorMessage(cause));
        setRoutingError(settingsError(cause));
        return false;
      }
    })();
    routingSaveRef.current = operation;
    void operation.then(() => {
      if (routingSaveRef.current === operation) {
        routingSaveRef.current = null;
        setSavingRouting(false);
      }
    });
    return operation;
  }, [replaceRouting]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return undefined;
    return subscribeVoiceWakeSettingsProjection(
      (listener) => voiceWakeGatewayClient.subscribe(listener),
      replaceTriggers,
      replaceRouting,
    );
  }, [enabled, replaceRouting, replaceTriggers]);

  return {
    gatewayTriggers,
    routing,
    loading,
    savingTriggers,
    savingRouting,
    triggerError,
    routingError,
    talkReady,
    talkProvider,
    talkError,
    refresh,
    saveTriggers,
    saveRouting,
  };
}
