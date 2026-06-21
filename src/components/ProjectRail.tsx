import { useState, useMemo } from "react";
import { Plus, Folder } from "lucide-react";

export interface RailProject {
  id: string;
  name: string;
  path: string;
}

function ProjectAvatar({
  name,
  size = 28,
}: {
  name: string;
  size?: number;
}) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        flexShrink: 0,
        background: "linear-gradient(135deg, rgb(var(--aegis-primary-deep)), rgb(var(--aegis-primary)))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.38,
        fontWeight: 700,
        color: "var(--fg-on-accent)",
        letterSpacing: 0.3,
      }}
    >
      {initials}
    </div>
  );
}

export function ProjectRail({
  projects,
  activeProjectId,
  onSwitch,
  onOpen,
}: {
  projects: RailProject[];
  activeProjectId: string;
  onSwitch: (project: RailProject) => void;
  onOpen: () => void;
}) {
  return (
    <div
      style={{
        width: 52,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 10,
        paddingBottom: 10,
        gap: 5,
        overflow: "visible",
      }}
    >
      {projects.map((project) => (
        <RailItem
          key={project.id}
          project={project}
          isActive={project.id === activeProjectId}
          onSwitch={onSwitch}
        />
      ))}

      <div style={{ flex: 1 }} />

      <button
        title="Open project"
        onClick={onOpen}
        style={{
          width: 32,
          height: 32,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderRadius: 8,
          cursor: "pointer",
          color: "var(--text-muted)",
        }}
      >
        <Plus size={14} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function RailItem({
  project,
  isActive,
  onSwitch,
}: {
  project: RailProject;
  isActive: boolean;
  onSwitch: (p: RailProject) => void;
}) {
  const [hov, setHov] = useState(false);

  return (
    <button
      title={project.name}
      onClick={() => onSwitch(project)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "relative",
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        borderRadius: 10,
        cursor: isActive ? "default" : "pointer",
        padding: 0,
        outline: isActive
          ? "2px solid var(--accent)"
          : hov
            ? "2px solid var(--border-medium)"
            : "2px solid transparent",
        outlineOffset: 1,
        transition: isActive ? "none" : "outline-color 0.12s",
      }}
    >
      <ProjectAvatar name={project.name} size={28} />
    </button>
  );
}
