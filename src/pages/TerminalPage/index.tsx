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
  FolderOpen, GitBranch, History, X, Terminal, ChevronDown,
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

  // ── Terminal container height (ResizeObserver → exact px for xterm) ──
  const termWrapRef = useRef<HTMLDivElement>(null);
  const [termHeight, setTermHeight] = useState(400);
  useEffect(() => {
    const el = termWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const h = e?.contentRect?.height;
      if (h && h > 0) setTermHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        {/* AI tool launcher — dropdown like nezha agent picker */}
        {cliTools.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b shrink-0" style={{ borderColor: "var(--border-dim)", background: "var(--bg-sidebar)" }}>
          <Terminal size={11} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
          <span className="text-[10px] font-semibold text-aegis-text-dim uppercase tracking-wider mr-1 shrink-0">
            AI Tools
          </span>
          <AIToolDropdown tools={cliTools.filter(t => ['codex','claude','pi','cursor-agent','aider','ollama','qwen','gemini','cody','gptme'].includes(t.id))} onSelect={runTool} />
        </div>
        )}

        {/* Terminal */}
        <div ref={termWrapRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ShellTerminalPanel
            ref={panelRef}
            themeVariant={themeVariant}
            terminalFontSize={terminalFontSize}
            monoFontFamily={monoFontFamily}
            projectPath={projectPath}
            projectId="default"
            onClose={() => {}}
            height={termHeight}
          />
        </div>
      </div>

      {/* Right panel — between terminal and toolbar (nezha layout) */}
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

      {/* Right toolbar — outer-most 44px strip (nezha RightToolbar) */}
      <div style={{ width: 44, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "12px 4px", borderLeft: "1px solid var(--border-dim)", background: "var(--bg-sidebar)" }}>
        <IconBtn icon={<FolderOpen size={18} />} label="Files" active={rightPanel === "files"} onClick={() => togglePanel("files")} />
        <IconBtn icon={<GitBranch size={18} />} label="Changes" active={rightPanel === "git-changes"} onClick={() => togglePanel("git-changes")} />
        <IconBtn icon={<History size={18} />} label="History" active={rightPanel === "git-history"} onClick={() => togglePanel("git-history")} />
      </div>
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

function AIToolDropdown({ tools, onSelect }: { tools: CLITool[]; onSelect: (cmd: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  if (tools.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
        style={{
          color: "var(--text-secondary)",
          background: open ? "var(--bg-hover)" : "var(--bg-subtle)",
          border: "1px solid var(--border-dim)",
        }}
      >
        <span>Launch AI</span>
        <ChevronDown size={10} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.12s" }} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden w-48"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-dim)", boxShadow: "0 8px 32px rgba(0,0,0,0.25)" }}>
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => { onSelect(tool.cmd); setOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)]"
              style={{ color: "var(--text-secondary)" }}
            >
              <span>{tool.icon}</span>
              <span className="font-medium">{tool.label}</span>
              <span className="ml-auto text-[9px] opacity-50 font-mono">{tool.id}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
