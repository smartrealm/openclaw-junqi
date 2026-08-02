export type DynamicIslandAction =
  | { type: 'open-task'; taskId: string }
  | { type: 'open-session'; sessionKey: string }
  | { type: 'open-focus' }
  | { type: 'toggle-dnd' }
  | { type: 'pomodoro-toggle' }
  | { type: 'pomodoro-stop' }
  | { type: 'voice-stop' }
  | { type: 'hide' };

/** Hides immediately in the auxiliary window, then persists the user's intent in main. */
export function hideDynamicIsland(
  close: () => Promise<unknown>,
  emitAction: (action: DynamicIslandAction) => void,
): void {
  void close().catch(() => undefined);
  emitAction({ type: 'hide' });
}
