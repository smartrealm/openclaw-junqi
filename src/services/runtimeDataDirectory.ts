export interface RuntimeDataDirectoryResult {
  success: boolean;
  path?: string;
  error?: string;
}

/** Opens the selected runtime's persistent data directory in the native file manager. */
export async function openRuntimeDataDirectory(): Promise<RuntimeDataDirectoryResult> {
  const bridge = window.aegis?.runtimeData;
  if (!bridge) {
    return { success: false, error: 'Desktop runtime data access is unavailable.' };
  }
  return bridge.openStateDirectory();
}
