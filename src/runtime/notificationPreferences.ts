export interface NotificationPreferencesTarget {
  setEnabled(enabled: boolean): void;
  setSoundEnabled(enabled: boolean): void;
  setDndMode(enabled: boolean): void;
}

export interface NotificationPreferences {
  enabled: boolean;
  soundEnabled: boolean;
  dndMode: boolean;
}

export function applyNotificationPreferences(
  target: NotificationPreferencesTarget,
  preferences: NotificationPreferences,
): void {
  target.setEnabled(preferences.enabled);
  target.setSoundEnabled(preferences.soundEnabled);
  target.setDndMode(preferences.dndMode);
}
