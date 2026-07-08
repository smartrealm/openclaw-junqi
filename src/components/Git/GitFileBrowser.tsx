// ── Git File Browser — tree/list view for git file lists ──────────────────────
// Ported from nezha's git-view/GitFileBrowser with --aegis-* CSS var rewrites.
import {
  useState,
  useMemo,
  useCallback,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderClosed,
  File,
  ListTree,
  List,
} from "lucide-react";
import {
  getGitStatusColor,
  getGitStatusLabel,
  fileName,
  type FileViewMode,
  type GitFileBrowserScrollContext,
  type GitDirectoryActionTarget,
  type GitFileChange,
} from "./types";

// ── Constants ──

const ROW_HEIGHT = 24;

// ── Generic entry type (works for git status files and commit detail files) ──

export interface GitFileEntry {
  path: string;
  status?: string;
  staged?: boolean;
  additions?: number;
  deletions?: number;
  onClick?: (entry: GitFileEntry) => void;
}

function isGitFileChangeEntry(entry: GitFileEntry): entry is GitFileChange {
  return typeof entry.status === "string" && typeof entry.staged === "boolean";
}

// ── Props ──

interface GitFileBrowserProps {
  entries: GitFileEntry[];
  mode: FileViewMode;
  scrollContext?: GitFileBrowserScrollContext;
  showStats?: boolean;
  onFileClick?: (entry: GitFileEntry) => void;
  onStageToggle?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
  onDirectoryStageToggle?: (
    dir: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => void | Promise<void>;
  onDiscard?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
  onDirectoryDiscard?: (
    dir: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => void | Promise<void>;
  autoCollapseLargeDirectories?: boolean;
}

// ── Tree node types ──

interface TreeNode {
  kind: "file";
  name: string;
  path: string;
  entry: GitFileEntry;
}

interface TreeDir {
  kind: "dir";
  name: string;
  path: string;
  children: Map<string, TreeNode | TreeDir>;
  filePaths: string[];
  staged: boolean;
  untracked: boolean;
}

// ── Build tree from flat file list ──

function buildTree(
  entries: GitFileEntry[],
): { root: Map<string, TreeNode | TreeDir>; fileCount: number } {
  const root = new Map<string, TreeNode | TreeDir>();

  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (parts.length === 1) {
      root.set(parts[0], { kind: "file", name: parts[0], path: entry.path, entry });
      continue;
    }

    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const fullPath = parts.slice(0, i + 1).join("/");

      if (i === parts.length - 1) {
        current.set(part, { kind: "file", name: part, path: entry.path, entry });
        break;
      }

      let dir = current.get(part);
      if (!dir || dir.kind !== "dir") {
        dir = {
          kind: "dir",
          name: part,
          path: fullPath,
          children: new Map(),
          filePaths: [],
          staged: entry.staged ?? false,
          untracked: entry.status === "?",
        };
        current.set(part, dir);
      } else {
        const d = dir as TreeDir;
        if (entry.staged === false) d.staged = false;
        if (entry.status !== "?") d.untracked = false;
      }
      const d = dir as TreeDir;
      d.filePaths.push(entry.path);

      current = d.children;
    }
  }

  return { root, fileCount: entries.length };
}

// ── Components ──

function DirectoryNode({
  node,
  depth,
  mode,
  onFileClick,
  onStageToggle,
  onDirectoryStageToggle,
  onDiscard,
  onDirectoryDiscard,
}: {
  node: TreeDir;
  depth: number;
  mode: FileViewMode;
  onFileClick?: (entry: GitFileEntry) => void;
  onStageToggle?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
  onDirectoryStageToggle?: (
    dir: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => void | Promise<void>;
  onDiscard?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
  onDirectoryDiscard?: (
    dir: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => void | Promise<void>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const children = [...node.children.values()];
  const nestedDirs = children.filter((c) => c.kind === "dir") as TreeDir[];
  const nestedFiles = children.filter((c) => c.kind === "file") as TreeNode[];

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: ROW_HEIGHT,
          paddingLeft: 8 + depth * 14,
          paddingRight: 10,
          gap: 5,
          cursor: "pointer",
          background: hovered ? "var(--aegis-hover)" : "transparent",
          boxSizing: "border-box",
          userSelect: "none",
          transition: "background 0.1s",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((v) => !v);
          }}
          style={{
            display: "flex",
            alignItems: "center",
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 0,
            color: "var(--aegis-text-dim)",
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        </button>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            color: "var(--aegis-text-muted)",
          }}
        >
          {collapsed ? <FolderClosed size={14} /> : <Folder size={14} />}
        </span>
        <span
          onClick={() => {
            if (mode === "list") {
              // In list mode, clicking a directory expands it into a flat list
              setCollapsed((v) => !v);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--aegis-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            background: "transparent",
            border: "none",
            textAlign: "left",
            cursor: "pointer",
            padding: 0,
            fontFamily: "inherit",
          }}
        >
          {node.name}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--aegis-text-dim)",
            background: "var(--aegis-card)",
            border: "1px solid var(--aegis-border)",
            borderRadius: 10,
            padding: "0 6px",
            minWidth: 18,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {node.filePaths.length}
        </span>
      </div>

      {!collapsed && (
        <>
          {nestedDirs.map((dir) => (
            <DirectoryNode
              key={dir.name}
              node={dir}
              depth={depth + 1}
              mode={mode}
              onFileClick={onFileClick}
              onStageToggle={onStageToggle}
              onDirectoryStageToggle={onDirectoryStageToggle}
              onDiscard={onDiscard}
              onDirectoryDiscard={onDirectoryDiscard}
            />
          ))}
          {nestedFiles.map((file) => (
            <FileRow
              key={file.path}
              entry={file.entry}
              depth={depth + 1}
              mode={mode}
              showStats={false}
              onClick={onFileClick ? () => onFileClick(file.entry) : undefined}
              onStageToggle={onStageToggle}
              onDiscard={onDiscard}
            />
          ))}
        </>
      )}
    </>
  );
}

function FileRow({
  entry,
  depth,
  mode,
  showStats,
  onClick,
  onStageToggle,
  onDiscard,
}: {
  entry: GitFileEntry;
  depth: number;
  mode: FileViewMode;
  showStats: boolean;
  onClick?: () => void;
  onStageToggle?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
  onDiscard?: (entry: GitFileChange, e: React.MouseEvent) => void | Promise<void>;
}) {
  const [hovered, setHovered] = useState(false);
  const statusColor = getGitStatusColor(entry.status ?? "M");
  const statusLabel = getGitStatusLabel(entry.status ?? "M");
  const isClickable = !!onClick;

  const basePaddingLeft = mode === "tree" ? 28 + depth * 14 : 14;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        paddingRight: 10,
        paddingLeft: basePaddingLeft,
        height: ROW_HEIGHT,
        cursor: isClickable ? "pointer" : "default",
        background: hovered ? "var(--aegis-hover)" : "transparent",
        transition: "background 0.1s",
        boxSizing: "border-box",
      }}
    >
      {/* Status dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
        }}
      />
      {/* Status label */}
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: statusColor,
          flexShrink: 0,
          width: 12,
          textAlign: "center",
        }}
      >
        {statusLabel}
      </span>
      {/* File name */}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          fontSize: 12.5,
          fontWeight: 500,
          color: hovered ? "var(--aegis-accent)" : "var(--aegis-text)",
        }}
      >
        {fileName(entry.path)}
      </span>
      {/* Stats */}
      {showStats && entry.additions !== undefined && (
        <span style={{ display: "flex", gap: 5, fontSize: 10.5, flexShrink: 0 }}>
          <span style={{ color: "#3fb950" }}>+{entry.additions}</span>
          <span style={{ color: "#f85149" }}>-{entry.deletions}</span>
        </span>
      )}
      {/* Action buttons */}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          flexShrink: 0,
          opacity: hovered ? 1 : 0,
          visibility: hovered ? "visible" : "hidden",
          transition: "opacity 0.1s",
        }}
      >
        {onStageToggle && isGitFileChangeEntry(entry) && (
          <button
            onClick={(e) => onStageToggle(entry, e)}
            title={entry.staged ? "Unstage" : "Stage"}
            style={{
              flexShrink: 0,
              background: "var(--aegis-card)",
              border: "1px solid var(--aegis-border)",
              borderRadius: 4,
              fontSize: 12,
              lineHeight: 1,
              padding: "1px 6px",
              color: "var(--aegis-text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            {entry.staged ? "-" : "+"}
          </button>
        )}
        {onDiscard && isGitFileChangeEntry(entry) && (
          <button
            onClick={(e) => onDiscard(entry, e)}
            title="Discard Changes"
            style={{
              flexShrink: 0,
              background: "var(--aegis-card)",
              border: "1px solid var(--aegis-border)",
              borderRadius: 4,
              padding: "2px 5px",
              color: "var(--aegis-text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <File size={11} />
          </button>
        )}
      </span>
    </div>
  );
}

// ── FileViewToggle ──

export function GitFileViewToggle({
  mode,
  onChange,
}: {
  mode: FileViewMode;
  onChange: (mode: FileViewMode) => void;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: 2,
        border: "1px solid var(--aegis-border)",
        borderRadius: 7,
        background: "var(--aegis-card)",
      }}
    >
      <ViewToggleBtn
        active={mode === "tree"}
        title="View as tree"
        onClick={() => onChange("tree")}
      >
        <ListTree size={14} />
      </ViewToggleBtn>
      <ViewToggleBtn
        active={mode === "list"}
        title="View as list"
        onClick={() => onChange("list")}
      >
        <List size={14} />
      </ViewToggleBtn>
    </div>
  );
}

function ViewToggleBtn({
  active,
  title,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      style={{
        width: 24,
        height: 22,
        border: "none",
        borderRadius: 5,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.1s, color 0.1s",
        background: active ? "var(--aegis-border-hover)" : "transparent",
        color: active ? "var(--aegis-text)" : "var(--aegis-text-dim)",
      }}
    >
      {children}
    </button>
  );
}

// ── useGitFileViewMode hook ──

export function useGitFileViewMode(): [FileViewMode, (m: FileViewMode) => void] {
  const [mode, setMode] = useState<FileViewMode>(() => {
    try {
      const stored = localStorage.getItem("git-file-view-mode");
      if (stored === "tree" || stored === "list") return stored;
    } catch {}
    return "list";
  });

  const setModeAndPersist = useCallback((m: FileViewMode) => {
    setMode(m);
    try {
      localStorage.setItem("git-file-view-mode", m);
    } catch {}
  }, []);

  return [mode, setModeAndPersist];
}

// ── Main GitFileBrowser component ──

export function GitFileBrowser({
  entries,
  mode,
  scrollContext,
  showStats,
  onFileClick,
  onStageToggle,
  onDirectoryStageToggle,
  onDiscard,
  onDirectoryDiscard,
  autoCollapseLargeDirectories,
}: GitFileBrowserProps) {
  if (mode === "tree") {
    const { root } = useMemo(() => buildTree(entries), [entries]);
    const children = [...root.values()];
    const dirs = children.filter((c) => c.kind === "dir") as TreeDir[];
    const files = children.filter((c) => c.kind === "file") as TreeNode[];

    return (
      <>
        {dirs.map((dir) => (
          <DirectoryNode
            key={dir.name}
            node={dir}
            depth={0}
            mode={mode}
            onFileClick={onFileClick}
            onStageToggle={onStageToggle}
            onDirectoryStageToggle={onDirectoryStageToggle}
            onDiscard={onDiscard}
            onDirectoryDiscard={onDirectoryDiscard}
          />
        ))}
        {files.map((file) => (
          <FileRow
            key={file.path}
            entry={file.entry}
            depth={0}
            mode={mode}
            showStats={showStats ?? false}
            onClick={onFileClick ? () => onFileClick(file.entry) : undefined}
            onStageToggle={onStageToggle}
            onDiscard={onDiscard}
          />
        ))}
      </>
    );
  }

  // List mode — flat rendering
  return (
    <>
      {entries.map((entry) => (
        <FileRow
          key={entry.path}
          entry={entry}
          depth={0}
          mode={mode}
          showStats={showStats ?? false}
          onClick={onFileClick ? () => onFileClick(entry) : undefined}
          onStageToggle={onStageToggle}
          onDiscard={onDiscard}
        />
      ))}
    </>
  );
}
