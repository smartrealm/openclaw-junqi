import { useState, useCallback, useMemo } from "react";
import { Folder, GitBranch, History, Settings, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ProjectRail, type RailProject } from "@/components/ProjectRail";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { layout, common } from "@/styles/nezha-shared-styles";

// ═══════════════════════════════════════════════════════════
// Hardcoded project list — wire real data later.
// ═══════════════════════════════════════════════════════════
const DEFAULT_PROJECTS: RailProject[] = [
  {
    id: "openclaw-junqi",
    name: "openclaw-junqi",
    path: "/Users/wei/DevTool/project/mine/gui/openclaw-junqi",
  },
];

// ═══════════════════════════════════════════════════════════
// RightToolbar (1:1 port from nezha, CSS-vars only)
// ═══════════════════════════════════════════════════════════
type RightPanel = "files" | "git-changes" | "git-history" | null;

function IconButton({
  icon,
  title,
  active = false,
  disabled = false,
  onClick,
  size = 32,
}: {
  icon: React.ReactNode;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  size?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const showHover = hovered && !disabled && !active;

  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? "var(--control-active-bg)" : showHover ? "var(--bg-hover)" : "none",
        border: "none",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        color: active ? "var(--control-active-fg)" : showHover ? "var(--text-muted)" : "var(--text-hint)",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.12s, color 0.12s",
        flexShrink: 0,
      }}
    >
      {icon}
    </button>
  );
}

function RightToolbar({
  activePanel,
  onToggle,
  terminalActive,
  onToggleTerminal,
}: {
  activePanel: RightPanel;
  onToggle: (panel: Exclude<RightPanel, null>) => void;
  terminalActive: boolean;
  onToggleTerminal: () => void;
}) {
  const { t } = useTranslation();
  const buttons: Array<{
    key: Exclude<RightPanel, null>;
    icon: React.ReactNode;
    title: string;
  }> = [
    { key: "files", icon: <Folder size={17} />, title: t("toolbar.fileExplorer", "File Explorer") },
    { key: "git-changes", icon: <GitBranch size={17} />, title: t("toolbar.gitChanges", "Git Changes") },
    { key: "git-history", icon: <History size={17} />, title: t("toolbar.gitHistory", "Git History") },
  ];

  return (
    <div
      style={{
        width: 44,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 6,
        paddingBottom: 8,
        gap: 2,
        overflow: "hidden",
      }}
    >
      {buttons.map((btn) => (
        <IconButton
          key={btn.key}
          icon={btn.icon}
          title={btn.title}
          active={activePanel === btn.key}
          onClick={() => onToggle(btn.key)}
        />
      ))}

      <IconButton
        icon={<Terminal size={17} />}
        title={t("terminal.title", "Terminal")}
        active={terminalActive}
        onClick={onToggleTerminal}
      />

      <div style={{ flex: 1 }} />

      <IconButton
        icon={<Settings size={17} />}
        title={t("settings.title", "Settings")}
        onClick={() => {}}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Right Panel Content Placeholders
// These use the nezha CSS var bridge so when real components
// are wired in, the layout is already correct.
// ═══════════════════════════════════════════════════════════
function FilesPanel({ projectPath, width }: { projectPath: string; width: number }) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--border-dim)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-hint)",
            letterSpacing: 0.7,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          Files
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontSize: 12,
          color: "var(--text-hint)",
          textAlign: "center",
        }}
      >
        File explorer will be integrated here.
      </div>
    </div>
  );
}

function GitChangesPanel({ projectPath, width }: { projectPath: string; width: number }) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--border-dim)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-hint)",
            letterSpacing: 0.7,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          Git Changes
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontSize: 12,
          color: "var(--text-hint)",
          textAlign: "center",
        }}
      >
        Git changes will be integrated here.
      </div>
    </div>
  );
}

function GitHistoryPanel({ projectPath, width }: { projectPath: string; width: number }) {
  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderLeft: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--border-dim)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text-hint)",
            letterSpacing: 0.7,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          Git History
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          fontSize: 12,
          color: "var(--text-hint)",
          textAlign: "center",
        }}
      >
        Git history will be integrated here.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Content Area
// Shows the active project info and a prompt to use the
// right toolbar. Will evolve into the terminal / tab area.
// ═══════════════════════════════════════════════════════════
function MainContentArea({ project }: { project: RailProject }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 48px",
        gap: 12,
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--text-primary)",
          letterSpacing: -0.3,
        }}
      >
        {project.name}
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: "var(--text-muted)",
          fontFamily: "ui-monospace, SF Mono, monospace",
        }}
      >
        {project.path}
      </div>
      <div
        style={{
          marginTop: 12,
          fontSize: 13,
          color: "var(--text-hint)",
        }}
      >
        Select a tool from the right toolbar to get started.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// ProjectPage — unified project workspace
//
// Layout (1:1 nezha layout):
//   ┌──────────┬─────────────────────────┬────┬──────┐
//   │ Project  │  Main Content Area      │ R  │ Right │
//   │ Rail     │  (terminal / tabs)      │ P  │ Tool- │
//   │ (52px)   │                         │ a  │ bar   │
//   │          │                         │ n  │(44px) │
//   │          │                         │ e  │       │
//   │          │                         │ l  │       │
//   └──────────┴─────────────────────────┴────┴──────┘
// ═══════════════════════════════════════════════════════════
export default function ProjectPage() {
  const [projects] = useState<RailProject[]>(DEFAULT_PROJECTS);
  const [activeProjectId, setActiveProjectId] = useState(DEFAULT_PROJECTS[0].id);
  const [rightPanel, setRightPanel] = useState<RightPanel>(null);
  const [terminalActive, setTerminalActive] = useState(false);
  const [rightPanelWidth] = useState(280);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  );

  const handleTogglePanel = useCallback((panel: Exclude<RightPanel, null>) => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleTerminalToggle = useCallback(() => {
    setTerminalActive((v) => !v);
  }, []);

  const handleSwitchProject = useCallback((project: RailProject) => {
    setActiveProjectId(project.id);
  }, []);

  const handleOpen = useCallback(() => {
    // Will wire real "open folder" dialog later
  }, []);

  return (
    <div
      style={{
        ...layout.projectBody,
        position: "absolute",
        inset: 0,
        display: "flex",
      }}
    >
      {/* Left: Project Rail */}
      <ProjectRail
        projects={projects}
        activeProjectId={activeProjectId}
        onSwitch={handleSwitchProject}
        onOpen={handleOpen}
      />

      {/* Center: Main Content */}
      <div style={{ ...layout.mainContent, flexDirection: "column" }}>
        <ErrorBoundary>
          <MainContentArea project={activeProject} />
        </ErrorBoundary>
      </div>

      {/* Right: Panel content (toggled via RightToolbar) */}
      {rightPanel && (
        <div style={{ position: "relative", display: "flex", flexShrink: 0 }}>
          {/* Resize handle */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 5,
              cursor: "col-resize",
              zIndex: 10,
            }}
          />
          {rightPanel === "files" && (
            <ErrorBoundary>
              <FilesPanel projectPath={activeProject.path} width={rightPanelWidth} />
            </ErrorBoundary>
          )}
          {rightPanel === "git-changes" && (
            <ErrorBoundary>
              <GitChangesPanel projectPath={activeProject.path} width={rightPanelWidth} />
            </ErrorBoundary>
          )}
          {rightPanel === "git-history" && (
            <ErrorBoundary>
              <GitHistoryPanel projectPath={activeProject.path} width={rightPanelWidth} />
            </ErrorBoundary>
          )}
        </div>
      )}

      {/* Right Toolbar */}
      <RightToolbar
        activePanel={rightPanel}
        onToggle={handleTogglePanel}
        terminalActive={terminalActive}
        onToggleTerminal={handleTerminalToggle}
      />
    </div>
  );
}
