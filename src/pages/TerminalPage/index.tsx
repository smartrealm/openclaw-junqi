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
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { homeDir } from "@tauri-apps/api/path";
import type { ThemeVariant, TerminalFontSize, FontFamily } from "@/_nezha_root/types";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
} from "@/_nezha_root/types";
import {
  FolderOpen, GitBranch, History, X, Terminal, Sparkles, Command,
} from "lucide-react";

// ── CLI tool definitions ────────────────────────────────────────────

interface CLITool {
  id: string;
  label: string;
  cmd: string;
  icon: string;
  color: string;
}

/** Tools that write their full CLI command to the terminal on click. */
const CLI_TOOLS: CLITool[] = [
  { id: "codex",    label: "Codex",    cmd: "codex\n",       icon: "🧠", color: "var(--aegis-accent)" },
  { id: "claude",   label: "Claude",   cmd: "claude\n",      icon: "🤖", color: "var(--aegis-primary)" },
  { id: "pi",       label: "Pi",       cmd: "pi\n",          icon: "💡", color: "var(--aegis-warning)" },
  { id: "cursor",   label: "Cursor",   cmd: "cursor-agent\n",icon: "🖱️", color: "var(--aegis-success)" },
  { id: "gh",       label: "GH CLI",   cmd: "gh ",           icon: "🐙", color: "var(--aegis-text-dim)" },
  { id: "docker",   label: "Docker",   cmd: "docker ",       icon: "🐳", color: "var(--aegis-text-dim)" },
  { id: "git-log",  label: "Git Log",  cmd: "git log --oneline -10\n", icon: "📜", color: "var(--aegis-text-dim)" },
  { id: "npm",      label: "npm",      cmd: "npm ",          icon: "📦", color: "var(--aegis-text-dim)" },
];

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
        {/* CLI tool quick-launch bar */}
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0 overflow-x-auto scrollbar-hidden"
          style={{ borderColor: "var(--border-dim)", background: "var(--bg-sidebar)" }}>
          <Terminal size={12} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <span className="text-[10px] font-semibold text-aegis-text-dim uppercase tracking-wider mr-2 shrink-0 hidden sm:inline">
            {t("terminal.tools", "Quick Launch")}
          </span>
          {CLI_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => runTool(tool.cmd)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium shrink-0 transition-colors"
              style={{
                color: "var(--text-secondary)",
                background: "var(--bg-subtle)",
                border: "1px solid var(--border-dim)",
              }}
              title={`Run: ${tool.cmd.trim()}`}
            >
              <span>{tool.icon}</span>
              <span className="hidden md:inline">{tool.label}</span>
            </button>
          ))}
          {/* Divider + custom input */}
          <span className="w-px h-4 mx-1 shrink-0 hidden sm:block" style={{ background: "var(--border-dim)" }} />
          <input
            placeholder="cmd…"
            className="hidden sm:block w-[80px] bg-transparent border-none outline-none text-[11px] text-aegis-text-muted placeholder:text-aegis-text-dim"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                runTool(e.currentTarget.value + "\n");
                e.currentTarget.value = "";
              }
            }}
          />
        </div>

        {/* Terminal */}
        <div style={{ flex: 1, minHeight: 0 }}>
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
