// ═══════════════════════════════════════════════════════════
// FileExplorer — clipboard helper
// ═══════════════════════════════════════════════════════════

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API may be unavailable in some contexts (e.g. Tauri permission)
    console.warn("[FileExplorer] Failed to write clipboard text");
  }
}
