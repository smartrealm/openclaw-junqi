import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getNativeVoiceWakeCapability,
  startNativeVoiceWake,
  stopNativeVoiceWake,
} from '@/api/tauri-commands';
import {
  decodeNativeVoiceWakeEvent,
  NATIVE_VOICE_WAKE_EVENT,
  normalizeNativeVoiceWakeTriggers,
} from '@/api/nativeVoiceWakeContract';
import { voiceWakeGatewayClient } from '@/services/gateway';
import {
  resolveNativeVoiceWakePolicy,
  type NativeVoiceWakePhase,
} from '@/services/voice/NativeVoiceWakePolicy';
import { resolveNativeVoiceWakeTarget } from '@/services/voice/NativeVoiceWakeRouting';
import type { VoiceWakeRouteTarget, VoiceWakeRoutingConfig } from '@/types/voiceWake';
import { debugError } from '@/utils/debugLog';
import { subscribeTauriEventReady } from '@/utils/tauriEvents';

const VOICE_WAKE_ENABLED_STORAGE_KEY = 'junqi:windows-voice-wake-enabled';

export interface NativeVoiceWakeState {
  supported: boolean | null;
  engine: 'windows-sapi' | null;
  enabled: boolean;
  phase: NativeVoiceWakePhase;
  error: NativeVoiceWakeErrorCode | null;
  lastTrigger: string | null;
  setEnabled: (enabled: boolean) => void;
}

export type NativeVoiceWakeErrorCode =
  | 'capability_unavailable'
  | 'gateway_config_unavailable'
  | 'native_listener_failed'
  | 'route_unavailable';

interface NativeVoiceWakeRuntimeError {
  code: Exclude<NativeVoiceWakeErrorCode, 'gateway_config_unavailable'>;
  detail: string;
}

interface UseNativeVoiceWakeOptions {
  connected: boolean;
  voiceBusy: boolean;
  onDetected: (
    trigger: string,
    target: VoiceWakeRouteTarget,
    resolvedAgentSessionKey: string | null,
  ) => void | Promise<void>;
}

function readStoredEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(VOICE_WAKE_ENABLED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function createOwnerId(): string {
  const id = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `voice-wake:${id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Windows 本地唤醒只负责启动现有 Talk，不生成 OpenClaw transcript 内容。 */
export function useNativeVoiceWake({
  connected,
  voiceBusy,
  onDetected,
}: UseNativeVoiceWakeOptions): NativeVoiceWakeState {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [engine, setEngine] = useState<'windows-sapi' | null>(null);
  const [enabled, setEnabledState] = useState(readStoredEnabled);
  const [phase, setPhase] = useState<NativeVoiceWakePhase>('checking');
  const [runtimeError, setRuntimeError] = useState<NativeVoiceWakeRuntimeError | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [triggers, setTriggers] = useState<string[] | null>(null);
  const [routingReady, setRoutingReady] = useState(false);
  const [lastTrigger, setLastTrigger] = useState<string | null>(null);
  const triggersRef = useRef<string[] | null>(null);
  const routingRef = useRef<VoiceWakeRoutingConfig | null>(null);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    setRuntimeError(null);
    try {
      window.localStorage.setItem(VOICE_WAKE_ENABLED_STORAGE_KEY, String(next));
    } catch {
      // 本地偏好保存失败不改变本次会话的显式用户选择。
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getNativeVoiceWakeCapability().then((capability) => {
      if (cancelled) return;
      setSupported(capability.supported);
      setEngine(capability.engine);
      setRuntimeError(null);
    }).catch((cause) => {
      if (cancelled) return;
      const message = errorMessage(cause);
      setSupported(false);
      setEngine(null);
      setRuntimeError({ code: 'capability_unavailable', detail: message });
      debugError('media', '[NativeVoiceWake] 读取原生唤醒能力失败：', message);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setTriggers(null);
    triggersRef.current = null;
    routingRef.current = null;
    setRoutingReady(false);
    setConfigError(null);
    if (!enabled || supported !== true || !connected) return undefined;

    let cancelled = false;
    const applyTriggers = (values: readonly string[]) => {
      const normalized = normalizeNativeVoiceWakeTriggers(values);
      if (!normalized) {
        triggersRef.current = null;
        setTriggers(null);
        setConfigError('Gateway 未提供可用的语音唤醒词');
        return;
      }
      triggersRef.current = normalized;
      setTriggers(normalized);
      if (routingRef.current) setConfigError(null);
    };
    const applyRouting = (routing: VoiceWakeRoutingConfig) => {
      routingRef.current = routing;
      setRoutingReady(true);
      if (triggersRef.current) setConfigError(null);
    };
    const unsubscribe = voiceWakeGatewayClient.subscribe((event) => {
      if (cancelled) return;
      if (event.type === 'triggers') applyTriggers(event.snapshot.triggers);
      else applyRouting(event.config);
    });
    void Promise.all([
      voiceWakeGatewayClient.getTriggers(),
      voiceWakeGatewayClient.getRouting(),
    ]).then(([snapshot, routing]) => {
      if (cancelled) return;
      applyTriggers(snapshot.triggers);
      applyRouting(routing);
    }).catch((cause) => {
      if (cancelled) return;
      const message = errorMessage(cause);
      setTriggers(null);
      triggersRef.current = null;
      routingRef.current = null;
      setRoutingReady(false);
      setConfigError(message);
      debugError('gateway', '[NativeVoiceWake] 读取 Gateway 唤醒词失败：', message);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connected, enabled, supported]);

  useEffect(() => {
    const policyError = runtimeError?.detail ?? configError;
    const policy = resolveNativeVoiceWakePolicy({
      capability: supported,
      enabled,
      connected,
      voiceBusy,
      triggersReady: triggers !== null && routingReady,
      error: policyError,
    });
    if (!policy.shouldListen || !triggers) {
      setPhase(policy.phase);
      return undefined;
    }

    let cancelled = false;
    let detected = false;
    let releaseListener: (() => void) | null = null;
    const ownerId = createOwnerId();
    setPhase('preparing');
    setRuntimeError(null);

    void (async () => {
      try {
        releaseListener = await subscribeTauriEventReady<unknown>(
          NATIVE_VOICE_WAKE_EVENT,
          async (tauriEvent) => {
            const event = decodeNativeVoiceWakeEvent(tauriEvent.payload);
            if (cancelled || detected || !event || event.ownerId !== ownerId) return;
            if (event.state === 'listening') {
              setPhase('listening');
              return;
            }
            if (event.state === 'error') {
              setRuntimeError({ code: 'native_listener_failed', detail: event.error });
              setPhase('error');
              void stopNativeVoiceWake(ownerId).catch(() => undefined);
              return;
            }
            if (event.state === 'stopped') {
              setRuntimeError({
                code: 'native_listener_failed',
                detail: 'Windows 本地语音唤醒意外停止',
              });
              setPhase('error');
              return;
            }
            detected = true;
            setLastTrigger(event.trigger);
            setPhase('activating');
            try {
              await stopNativeVoiceWake(ownerId);
            } catch (cause) {
              if (cancelled) return;
              setRuntimeError({ code: 'native_listener_failed', detail: errorMessage(cause) });
              setPhase('error');
              return;
            }
            if (cancelled) return;
            try {
              const routing = routingRef.current;
              if (!routing) throw new Error('Gateway 语音唤醒路由尚未就绪');
              const target = resolveNativeVoiceWakeTarget(routing, event.trigger);
              const resolvedAgentSessionKey = 'agentId' in target
                ? await voiceWakeGatewayClient.resolveAgentMainSessionKey(target.agentId)
                : null;
              if ('agentId' in target && !resolvedAgentSessionKey) {
                throw new Error('Gateway 未找到语音唤醒智能体的会话');
              }
              await onDetectedRef.current(event.trigger, target, resolvedAgentSessionKey);
            } catch (cause) {
              setRuntimeError({ code: 'route_unavailable', detail: errorMessage(cause) });
              setPhase('error');
            }
          },
          (cause) => {
            if (cancelled) return;
            const message = errorMessage(cause);
            setRuntimeError({ code: 'native_listener_failed', detail: message });
            setPhase('error');
          },
        );
        if (cancelled) {
          releaseListener();
          releaseListener = null;
          return;
        }
        const result = await startNativeVoiceWake(ownerId, triggers);
        if (cancelled) {
          if (result.listening) await stopNativeVoiceWake(ownerId).catch(() => undefined);
          return;
        }
        if (!result.supported) {
          setSupported(false);
          setEngine(null);
          setPhase('unsupported');
          return;
        }
        if (!result.listening) throw new Error('Windows 本地语音唤醒未进入监听状态');
        setPhase('listening');
      } catch (cause) {
        if (cancelled) return;
        const message = errorMessage(cause);
        setRuntimeError({ code: 'native_listener_failed', detail: message });
        setPhase('error');
        debugError('media', '[NativeVoiceWake] 启动 Windows 本地唤醒失败：', message);
      }
    })();

    return () => {
      cancelled = true;
      releaseListener?.();
      void stopNativeVoiceWake(ownerId).catch(() => undefined);
    };
  }, [configError, connected, enabled, routingReady, runtimeError, supported, triggers, voiceBusy]);

  return {
    supported,
    engine,
    enabled,
    phase,
    error: runtimeError?.code ?? (configError ? 'gateway_config_unavailable' : null),
    lastTrigger,
    setEnabled,
  };
}
