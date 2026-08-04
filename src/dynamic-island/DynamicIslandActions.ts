export type DynamicIslandAction =
  | { type: 'open-task'; taskId: string }
  | { type: 'open-session'; sessionKey: string }
  | { type: 'open-focus' }
  | { type: 'toggle-dnd' }
  | { type: 'pomodoro-toggle' }
  | { type: 'pomodoro-stop' }
  | { type: 'voice-stop' }
  | { type: 'hide' };

/** Returns the hide request to the main-window visibility owner. */
export function hideDynamicIsland(
  emitAction: (action: DynamicIslandAction) => void,
): void {
  emitAction({ type: 'hide' });
}
