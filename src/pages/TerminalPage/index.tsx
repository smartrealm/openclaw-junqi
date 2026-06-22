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
        {/* Agent launcher — nezha-style: agent dropdown + permission + launch */}
        {cliTools.length > 0 && (
        <AgentLaunchBar tools={cliTools} onLaunch={runTool} />
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

// ── Agent launch bar — nezha-style agent + permission picker ──

const AI_AGENTS = ["codex", "claude", "pi", "cursor-agent"] as const;
const PERM_MODES = ["ask", "auto_edit", "full_access"] as const;
type PermMode = typeof PERM_MODES[number];

function AgentLaunchBar({ tools, onLaunch }: { tools: CLITool[]; onLaunch: (cmd: string) => void }) {
  const aiTools = tools.filter((t) => AI_AGENTS.includes(t.id as any));
  const [agent, setAgent] = useState(aiTools[0]?.id ?? "");
  const [perm, setPerm] = useState<PermMode>("ask");
  const [permOpen, setPermOpen] = useState(false);
  const permRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!permOpen) return;
    const h = (e: MouseEvent) => { if (permRef.current && !permRef.current.contains(e.target as Node)) setPermOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [permOpen]);

  if (aiTools.length === 0) return null;

  const launch = () => {
    const cmd = agent === "codex" || agent === "claude"
      ? `${agent} --permission-mode ${perm}\n`
      : `${agent}\n`;
    onLaunch(cmd);
  };

  const permLabel = (p: PermMode) => p === "ask" ? "Ask" : p === "auto_edit" ? "Auto Edit" : "Full Access";

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b shrink-0" style={{ borderColor: "var(--border-dim)", background: "var(--bg-sidebar)" }}>
      {/* Agent selector */}
      <div className="flex items-center gap-1">
        {aiTools.map((t) => (
          <button
            key={t.id}
            onClick={() => setAgent(t.id)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors"
            style={{
              color: agent === t.id ? "var(--control-active-fg)" : "var(--text-muted)",
              background: agent === t.id ? "var(--control-active-bg)" : "transparent",
              border: agent === t.id ? "1px solid var(--control-active-fg)" : "1px solid transparent",
            }}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Permission selector — only for claude/codex */}
      {(agent === "claude" || agent === "codex") && (
        <div ref={permRef} style={{ position: "relative" }}>
          <button
            onClick={() => setPermOpen((v) => !v)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium"
            style={{
              color: "var(--text-dim)",
              background: permOpen ? "var(--bg-hover)" : "transparent",
              border: "1px solid var(--border-dim)",
            }}
          >
            {permLabel(perm)}
            <ChevronDown size={8} />
          </button>
          {permOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden w-28"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-dim)", boxShadow: "0 8px 24px rgba(0,0,0,0.2)" }}>
              {PERM_MODES.map((p) => (
                <button
                  key={p}
                  onClick={() => { setPerm(p); setPermOpen(false); }}
                  className="w-full px-3 py-1.5 text-[10px] text-left transition-colors hover:bg-[rgb(var(--aegis-overlay)/0.06)]"
                  style={{ color: p === perm ? "var(--control-active-fg)" : "var(--text-secondary)", background: p === perm ? "var(--control-active-bg)" : "transparent" }}
                >
                  {permLabel(p)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Launch button */}
      <button
        onClick={launch}
        className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ml-auto transition-colors"
        style={{ color: "#fff", background: "var(--primary-action-bg)" }}
      >
        <Terminal size={10} />
        Launch
      </button>
    </div>
  );
}
