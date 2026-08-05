export type PrivacyLockReason =
  | 'manual'
  | 'shortcut'
  | 'idle'
  | 'system_lock'
  | 'suspend'
  | 'startup';

export type SystemAuthenticationAvailability =
  | 'available'
  | 'device_not_present'
  | 'not_configured'
  | 'disabled_by_policy'
  | 'busy'
  | 'unsupported'
  | 'unavailable';

export interface PrivacyLockSettings {
  enabled: boolean;
  autoLockSeconds: number;
  lockOnResume: boolean;
  lockOnStartup: boolean;
  globalShortcutEnabled: boolean;
  globalShortcut: string;
}

export interface PrivacyLockSnapshot {
  enabled: boolean;
  locked: boolean;
  revision: number;
  reason: PrivacyLockReason | null;
  retryAfterMs: number;
  failedAttempts: number;
  settings: PrivacyLockSettings;
  systemAuthentication: SystemAuthenticationAvailability;
  idleDetectionSupported: boolean;
  shortcutRegistered: boolean;
  shortcutError: boolean;
}

export const DEFAULT_PRIVACY_LOCK_SETTINGS: PrivacyLockSettings = {
  enabled: false,
  autoLockSeconds: 300,
  lockOnResume: true,
  lockOnStartup: true,
  globalShortcutEnabled: true,
  globalShortcut: 'CommandOrControl+Shift+L',
};
