export type DynamicIslandAction =
  | { type: 'open-session'; sessionKey: string }
  | { type: 'open-focus' }
  | { type: 'toggle-dnd' }
  | { type: 'pomodoro-toggle' }
  | { type: 'pomodoro-stop' }
  | { type: 'voice-stop' }
  | { type: 'hide' };

/** 先要求原生窗口立即隐藏，再将持久化意图交给主窗口所有者。 */
export async function hideDynamicIsland(
  requestNativeHide: () => Promise<unknown>,
  emitAction: (action: DynamicIslandAction) => Promise<unknown>,
): Promise<void> {
  const [nativeResult, actionResult] = await Promise.allSettled([
    requestNativeHide(),
    emitAction({ type: 'hide' }),
  ]);
  if (nativeResult.status === 'rejected') throw nativeResult.reason;
  if (actionResult.status === 'rejected') throw actionResult.reason;
}
