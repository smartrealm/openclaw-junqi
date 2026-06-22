import { Fragment } from "react";
import { useTranslation } from "react-i18next";

const SHORTCUTS: { group: string; keys: { labelKey: string; combo: string }[] }[] = [
  {
    group: "general",
    keys: [
      { labelKey: "shortcuts.commandPalette", combo: "⌘K / Ctrl+K" },
      { labelKey: "shortcuts.settings", combo: "⌘, / Ctrl+," },
      { labelKey: "shortcuts.quickAction", combo: "⌘Shift+P" },
    ],
  },
  {
    group: "chat",
    keys: [
      { labelKey: "shortcuts.newChat", combo: "⌘N / Ctrl+N" },
      { labelKey: "shortcuts.sendMessage", combo: "Enter" },
      { labelKey: "shortcuts.newLine", combo: "Shift+Enter" },
      { labelKey: "shortcuts.switchTab", combo: "⌘1-9" },
    ],
  },
  {
    group: "navigation",
    keys: [
      { labelKey: "shortcuts.dashboard", combo: "Ctrl+1" },
      { labelKey: "shortcuts.chat", combo: "Ctrl+2" },
      { labelKey: "shortcuts.terminal", combo: "Ctrl+3" },
      { labelKey: "shortcuts.files", combo: "Ctrl+5" },
      { labelKey: "shortcuts.git", combo: "Ctrl+6" },
    ],
  },
];

export function ShortcutsPanel() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6 py-2">
      {SHORTCUTS.map((group) => (
        <div key={group.group}>
          <h3 className="text-[11px] font-semibold text-aegis-text-dim uppercase tracking-wider mb-3">
            {t(`shortcuts.group.${group.group}`, group.group)}
          </h3>
          <div className="flex flex-col gap-1">
            {group.keys.map((k) => (
              <div
                key={k.labelKey}
                className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[rgb(var(--aegis-overlay)/0.04)]"
              >
                <span className="text-[12px] text-aegis-text-secondary">
                  {t(k.labelKey, k.labelKey)}
                </span>
                <kbd className="px-2 py-0.5 rounded-md bg-aegis-elevated border border-aegis-border text-[10px] font-mono text-aegis-text-muted">
                  {k.combo}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
