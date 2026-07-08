// ═══════════════════════════════════════════════════════════
// FileExplorer — clipboard helper
// ═══════════════════════════════════════════════════════════

import { debugWarn } from "@/utils/debugLog";

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API may be unavailable in some contexts (e.g. Tauri permission)
    debugWarn("app", "[FileExplorer] Failed to write clipboard text");
  }
}
