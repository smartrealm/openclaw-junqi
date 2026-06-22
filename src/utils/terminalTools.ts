/**
 * Terminal CLI tool registry — persisted in localStorage for user customization.
 *
 * On first launch, auto-detected tools from the Rust backend are merged in.
 * Users can then add/remove/edit tools via Settings → Terminal.
 */

export interface CLITool {
  id: string;
  label: string;
  icon: string;
  cmd: string;
}

const STORAGE_KEY = "aegis:terminal-tools";

/** Default tools — used as fallback if localStorage is empty. */
const DEFAULTS: CLITool[] = [
  { id: "git-log",  label: "Git Log",  icon: "📜", cmd: "git log --oneline -20\n" },
  { id: "git-stat", label: "Git Status",icon: "📋", cmd: "git status\n" },
  { id: "npm",      label: "npm",      icon: "📦", cmd: "npm " },
  { id: "ls",       label: "List Files",icon: "📁", cmd: "ls -la\n" },
];

export function loadTools(): CLITool[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULTS;
}

export function saveTools(tools: CLITool[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tools));
}

/** Merge auto-detected tools into the persisted list, keeping user edits. */
export function mergeDetected(detected: CLITool[]): CLITool[] {
  const existing = loadTools();
  const byId = new Map(existing.map((t) => [t.id, t]));
  for (const d of detected) {
    if (!byId.has(d.id)) byId.set(d.id, d);
  }
  const merged = Array.from(byId.values());
  saveTools(merged);
  return merged;
}
