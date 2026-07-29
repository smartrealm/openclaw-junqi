export async function commitTerminalSettingsReset(
  persistNativeDefaults: () => Promise<void>,
  commitLocalDefaults: () => void,
): Promise<void> {
  await persistNativeDefaults();
  commitLocalDefaults();
}
