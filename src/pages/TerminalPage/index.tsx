// ═══════════════════════════════════════════════════════════
// Integrated Terminal — Multi-session xterm.js + portable-pty (Rust)
// Powered by the nezha-portable ShellTerminalPanel architecture:
//   - Bounded emit channel with backpressure propagation
//   - SmartWriter watermark flow control
//   - WebGL addon with font-ready deferred load
//   - macOS WKWebKit selection guard / IME fix
//   - Font-size / font-family live switching with atlas refresh
// ═══════════════════════════════════════════════════════════

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";
import {
  ShellTerminalPanel,
  type ShellTerminalPanelHandle,
} from "@/components/Terminal";
import { useRef, useCallback, useEffect, useState } from "react";
import type {
  ThemeVariant,
  TerminalFontSize,
  FontFamily,
} from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace('aegis-', '') as ThemeVariant;
  const panelRef = useRef<ShellTerminalPanelHandle>(null);

  const terminalFontSize: TerminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
  const monoFontFamily: FontFamily = getDefaultMonoFont();

  // Use the home directory as a default project path when no project is active.
  // TODO: wire this to the active project from the app store.
  const projectPath = ".";
  const projectId = "default";

  // Reactive height so terminal fills the page and responds to resize.
  const [panelHeight, setPanelHeight] = useState(() => window.innerHeight - 48);
  useEffect(() => {
    const onResize = () => setPanelHeight(window.innerHeight - 48);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <ShellTerminalPanel
        ref={panelRef}
        projectPath={projectPath}
        projectId={projectId}
        isActive
        onClose={() => {
          // Terminal panel is a permanent page; closing all sessions just
          // creates a fresh one.
        }}
        themeVariant={themeVariant}
        terminalFontSize={terminalFontSize}
        monoFontFamily={monoFontFamily}
        height={panelHeight}
      />
    </div>
  );
}
