// Terminal Workspace — Multi-session terminal + CLI tool quick-launch
// + right toolbar with File Explorer / Git Changes / Git History.

import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";
import {
  ShellTerminalPanel,
  type ShellTerminalPanelHandle,
} from "@/components/Terminal";
import { FileExplorer } from "@/components/FileExplorer";
import { GitChanges } from "@/components/Git";
import { GitHistory } from "@/components/Git";
import { useRef, useState, useCallback, useEffect } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
// (loadTools/mergeDetected were used by the removed AgentLaunchBar — no longer needed)
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";
import {
  X, ChevronDown,
} from "lucide-react";
import { Icon } from "@/components/shared/icons";

type RightPanel = null | "files" | "git-changes" | "git-history";

export function TerminalPage() {
  const { t } = useTranslation();
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace("aegis-", "") as ThemeVariant;
  const panelRef = useRef<ShellTerminalPanelHandle>(null);

  const terminalFontSize: TerminalFontSize = DEFAULT_TERMINAL_FONT_SIZE;
  const monoFontFamily: FontFamily = getDefaultMonoFont();
  const [projectPath, setProjectPath] = useState("/");
  useEffect(() => { homeDir().then(setProjectPath).catch(() => setProjectPath("/")); }, []);
  const projectName = projectPath.split("/").pop() || "home";

  // Terminal fills available flex space (no ResizeObserver needed)
  const termWrapRef = useRef<HTMLDivElement>(null);

  // Right panel
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const [isDragging, setIsDragging] = useState(false);

  const togglePanel = useCallback((panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => setRightPanelWidth(Math.max(240, Math.min(700, window.innerWidth - e.clientX)));
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [isDragging]);

  // Tool click → type command into active shell
  const runTool = useCallback((cmd: string) => {
    panelRef.current?.sendCommand(cmd);
  }, []);

  // ── Cross-page command bridge ──
  // Listen for `junqi:run-terminal-command` events from FileViewer's Makefile
  // run buttons (and any other component that wants to push a command into the
  // terminal without prop-drilling). The terminal panel must already be mounted.
  // If the user is on a different page the command silently drops — they'd need
  // to be on /terminal for it to land.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ command: string; projectPath?: string }>;
      const cmd = ce.detail?.command;
      if (!cmd) return;
      panelRef.current?.sendCommand(cmd);
    };
    window.addEventListener("junqi:run-terminal-command", handler);
    return () => window.removeEventListener("junqi:run-terminal-command", handler);
  }, []);

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--terminal-bg)" }}>
      {/* ── kooky 32pt top strip ── */}
      <div style={{ height: 32, flexShrink: 0, display: "flex", alignItems: "center", padding: "0 8px 0 0", gap: 0, borderBottom: "1px solid rgb(255 255 255 / 0.07)" }}>
        <div style={{ width: 82, flexShrink: 0 }} />
        <div style={{ flex: 1 }} />
        <button title="Open Agent Panel" onClick={() => togglePanel("files")} style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: 5, color: "rgb(var(--aegis-text-muted))", cursor: "pointer" }}>
          {Icon.chrome.grid}
        </button>
        <button title="Notifications" style={{ width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", borderRadius: 5, color: "rgb(var(--aegis-text-muted))", cursor: "pointer", position: "relative" }}>
          {Icon.chrome.bell}
          <span style={{ position: "absolute", top: 4, right: 4, width: 6, height: 6, borderRadius: 3, background: "rgb(var(--aegis-status-running))" }} />
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Main terminal area — kooky 1:1: tab strip at top, terminal fills below */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
          <div ref={termWrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ShellTerminalPanel
              ref={panelRef}
              themeVariant={themeVariant}
              terminalFontSize={terminalFontSize}
              monoFontFamily={monoFontFamily}
              projectPath={projectPath}
              projectId="default"
              onClose={() => {}}
              onSplitHorizontal={() => {
                import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
                  const ws = useWorkspaceStore.getState();
                  const active = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId);
                  if (active) ws.splitPane(active.focusedPaneId, 'horizontal');
                });
              }}
              onSplitVertical={() => {
                import('@/stores/workspaceStore').then(({ useWorkspaceStore }) => {
                  const ws = useWorkspaceStore.getState();
                  const active = ws.workspaces.find((w) => w.id === ws.activeWorkspaceId);
                  if (active) ws.splitPane(active.focusedPaneId, 'vertical');
                });
              }}
            />
          </div>
        </div>

      {/* Right panel — between terminal and toolbar */}
      {rightPanel && (<>
        <div onMouseDown={handleMouseDown} style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: isDragging ? "rgb(var(--aegis-primary))" : "transparent" }} />
        <div style={{ width: rightPanelWidth, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--aegis-border)", background: "var(--aegis-elevated)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--aegis-border)", flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgb(var(--aegis-text-secondary))", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {rightPanel === "files" ? "Files" : rightPanel === "git-changes" ? "Changes" : "History"}
            </span>
            <button onClick={() => setRightPanel(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "rgb(var(--aegis-text-dim))" }}>
              <X size={14} />
            </button>
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            {rightPanel === "files" && (
              <FileExplorer projectPath={projectPath} projectName={projectName} onFileSelect={() => {}} />
            )}
            {rightPanel === "git-changes" && (
              <GitChanges projectPath={projectPath} currentTaskCreatedAt={null} onFileSelect={() => {}} />
            )}
            {rightPanel === "git-history" && (
              <GitHistory projectPath={projectPath} onCommitSelect={() => {}} />
            )}
          </div>
        </div>
      </>)}

      {/* Right toolbar — outer-most 44px strip */}
      <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 4px", borderLeft: "1px solid var(--aegis-border)", background: "var(--aegis-surface)" }}>
        <IconBtn icon={Icon.nav.files} label="Files" active={rightPanel === "files"} onClick={() => togglePanel("files")} />
        <IconBtn icon={Icon.nav.git} label="Changes" active={rightPanel === "git-changes"} onClick={() => togglePanel("git-changes")} />
        <IconBtn icon={Icon.nav.history} label="History" active={rightPanel === "git-history"} onClick={() => togglePanel("git-history")} />
      </div>
      </div>
    </div>
  );
}

function IconBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer", background: active ? "rgba(var(--aegis-primary) / 0.10)" : "transparent", color: active ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text-muted))", transition: "background 0.12s, color 0.12s" }}>
      {icon}
    </button>
  );
}
