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
import { loadTools, mergeDetected, type CLITool } from "@/utils/terminalTools";
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";
import {
  FolderOpen, GitBranch, History, X, Terminal,
} from "lucide-react";

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

  // ── CLI tools: auto-detect + user-customizable (persisted to localStorage) ──
  const [cliTools, setCliTools] = useState<CLITool[]>(() => loadTools());
  useEffect(() => {
    invoke<CLITool[]>("detect_cli_tools")
      .then((detected) => setCliTools(mergeDetected(detected)))
      .catch(() => { /* keep existing tools */ });
  }, []);

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

  return (
    <div style={{ display: "flex", flex: 1, height: "100%", overflow: "hidden", background: "var(--bg-root)" }}>
      {/* Main terminal area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* CLI tool quick-launch bar — only shown when tools are detected */}
        {cliTools.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1 border-b shrink-0 overflow-x-auto scrollbar-hidden"
          style={{ borderColor: "var(--border-dim)", background: "var(--bg-sidebar)" }}>
          <Terminal size={11} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          {cliTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => runTool(tool.cmd)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 transition-colors hover:brightness-110"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-dim)",
              }}
              title={tool.label}
            >
              <span>{tool.icon}</span>
              <span className="hidden md:inline">{tool.label}</span>
            </button>
          ))}
        </div>
        )}

        {/* Terminal */}
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ShellTerminalPanel
            ref={panelRef}
            themeVariant={themeVariant}
            terminalFontSize={terminalFontSize}
            monoFontFamily={monoFontFamily}
            projectPath={projectPath}
            projectId="default"
            onClose={() => {}}
          />
        </div>
      </div>

      {/* Right toolbar */}
      <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 4px", borderLeft: "1px solid var(--border-dim)", background: "var(--bg-sidebar)" }}>
        <IconBtn icon={<FolderOpen size={18} />} label="Files" active={rightPanel === "files"} onClick={() => togglePanel("files")} />
        <IconBtn icon={<GitBranch size={18} />} label="Changes" active={rightPanel === "git-changes"} onClick={() => togglePanel("git-changes")} />
        <IconBtn icon={<History size={18} />} label="History" active={rightPanel === "git-history"} onClick={() => togglePanel("git-history")} />
      </div>

      {/* Right panel */}
      {rightPanel && (<>
        <div onMouseDown={handleMouseDown} style={{ width: 4, flexShrink: 0, cursor: "col-resize", background: isDragging ? "var(--accent)" : "transparent" }} />
        <div style={{ width: rightPanelWidth, flexShrink: 0, display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border-dim)", background: "var(--bg-panel)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-dim)", flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {rightPanel === "files" ? "Files" : rightPanel === "git-changes" ? "Changes" : "History"}
            </span>
            <button onClick={() => setRightPanel(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, borderRadius: 6, color: "var(--text-hint)" }}>
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
    </div>
  );
}

function IconBtn({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={label} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer", background: active ? "var(--control-active-bg)" : "transparent", color: active ? "var(--control-active-fg)" : "var(--text-muted)", transition: "background 0.12s, color 0.12s" }}>
      {icon}
    </button>
  );
}
