const AUTO_ARM_STORAGE_KEY = 'junqi:voice-wake:auto-arm:v1';

interface StoredAutoArmPreference {
  sessionKey: string;
  targetFingerprint: string;
}

export interface VoiceWakeStandbyBinding {
  sessionKey: string;
  targetFingerprint: string;
}

const listeners = new Set<() => void>();

function publish(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // 单个界面订阅者失败不能阻断其他运行时所有者同步待机偏好。
    }
  }
}

function writeAutoArmBinding(binding: VoiceWakeStandbyBinding | null): void {
  if (binding === null) {
    localStorage.removeItem(AUTO_ARM_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTO_ARM_STORAGE_KEY, JSON.stringify(binding));
}

export interface VoiceWakeAutostartController {
  enable: () => Promise<{ enabled: boolean }>;
  disable: () => Promise<{ enabled: boolean }>;
}

export function subscribeAutoArmPreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function autoArmBinding(): VoiceWakeStandbyBinding | null {
  try {
    const raw = localStorage.getItem(AUTO_ARM_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { sessionKey, targetFingerprint } = parsed as StoredAutoArmPreference;
    if (typeof sessionKey !== 'string' || typeof targetFingerprint !== 'string') return null;
    const normalizedSessionKey = sessionKey.trim();
    const normalizedTargetFingerprint = targetFingerprint.trim();
    return normalizedSessionKey && normalizedTargetFingerprint
      ? { sessionKey: normalizedSessionKey, targetFingerprint: normalizedTargetFingerprint }
      : null;
  } catch {
    return null;
  }
}

export function setAutoArmBinding(binding: VoiceWakeStandbyBinding): void {
  const sessionKey = binding.sessionKey.trim();
  const targetFingerprint = binding.targetFingerprint.trim();
  if (!sessionKey || !targetFingerprint) return;
  writeAutoArmBinding({ sessionKey, targetFingerprint });
  publish();
}

export function clearAutoArmSession(): void {
  writeAutoArmBinding(null);
  publish();
}

export function shouldAutoArmSession(
  sessionKey: string,
  targetFingerprint: string | null | undefined,
): boolean {
  const binding = autoArmBinding();
  return Boolean(
    binding
    && binding.sessionKey === sessionKey
    && targetFingerprint?.trim()
    && binding.targetFingerprint === targetFingerprint.trim(),
  );
}

/**
 * 仅在系统自动启动回执确认后发布待机会话，避免登录启动与恢复目标半配置。
 */
export async function enableVoiceWakeStandby(
  binding: VoiceWakeStandbyBinding,
  autostart: VoiceWakeAutostartController,
  isBindingCurrent: () => boolean,
): Promise<void> {
  const sessionKey = binding.sessionKey.trim();
  const targetFingerprint = binding.targetFingerprint.trim();
  if (!sessionKey) throw new Error('voice_wake_standby_session_missing');
  if (!targetFingerprint) throw new Error('voice_wake_standby_runtime_missing');
  if (!isBindingCurrent()) throw new Error('voice_wake_standby_runtime_changed');
  const status = await autostart.enable();
  if (!status.enabled) throw new Error('app_autostart_enable_not_confirmed');
  try {
    if (!isBindingCurrent()) throw new Error('voice_wake_standby_runtime_changed');
    writeAutoArmBinding({ sessionKey, targetFingerprint });
  } catch (error) {
    try {
      const restored = await autostart.disable();
      if (restored.enabled) throw new Error('app_autostart_disable_not_confirmed');
    } catch (rollbackError) {
      throw new Error(
        `voice_wake_standby_enable_rollback_failed:${error instanceof Error ? error.message : String(error)}:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    throw error;
  }
  publish();
}

/**
 * 仅在系统自动启动确认关闭后清理待机会话；本地清理失败时恢复系统自动启动。
 */
export async function disableVoiceWakeStandby(
  autostart: VoiceWakeAutostartController,
): Promise<void> {
  const status = await autostart.disable();
  if (status.enabled) throw new Error('app_autostart_disable_not_confirmed');
  try {
    writeAutoArmBinding(null);
  } catch (error) {
    try {
      const restored = await autostart.enable();
      if (!restored.enabled) throw new Error('app_autostart_enable_not_confirmed');
    } catch (rollbackError) {
      throw new Error(
        `voice_wake_standby_disable_rollback_failed:${error instanceof Error ? error.message : String(error)}:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
    }
    throw error;
  }
  publish();
}
