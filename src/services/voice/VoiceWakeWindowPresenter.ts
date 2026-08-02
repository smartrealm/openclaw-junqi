export interface VoiceWakeWindow {
  show(): Promise<void>;
  unminimize(): Promise<void>;
  setFocus(): Promise<void>;
}

export interface VoiceWakeWindowPresentation {
  visible: boolean;
  focused: boolean;
}

/** Restore the desktop surface without making focus acquisition a wake prerequisite. */
export async function presentVoiceWakeWindow(
  window: VoiceWakeWindow,
): Promise<VoiceWakeWindowPresentation> {
  const [show, unminimize] = await Promise.allSettled([
    window.show(),
    window.unminimize(),
  ]);
  if (show.status === 'rejected' || unminimize.status === 'rejected') {
    return { visible: false, focused: false };
  }

  try {
    await window.setFocus();
    return { visible: true, focused: true };
  } catch {
    // Some desktop environments forbid applications from stealing focus.
    return { visible: true, focused: false };
  }
}
