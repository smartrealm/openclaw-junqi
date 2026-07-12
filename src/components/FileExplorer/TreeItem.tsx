// ═══════════════════════════════════════════════════════════
// FileExplorer — TreeItem (single row in the file tree)
// ═══════════════════════════════════════════════════════════

import { memo } from "react";
import { ChevronRight, Folder, File, FolderOpen } from "lucide-react";
import type { TreeNode } from "./types";

export const TreeItem = memo(function TreeItem({
  node,
  depth,
  selectedPath,
  contextPath,
  onSelect,
  onToggle,
  onContextMenu,
  onPointerDown,
  draggingPath,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  contextPath: string | null;
  onSelect: (node: TreeNode) => void;
  onToggle: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  onPointerDown?: (e: React.PointerEvent, node: TreeNode) => void;
  draggingPath?: string | null;
}) {
  const isDir = node.is_dir;
  const isExpanded = node.expanded;
  const isSelected = node.path === selectedPath;
  const isContext = node.path === contextPath;
  const isDragging = node.path === draggingPath;
  const padLeft = 2 + depth * 16;

  const rowBg = isSelected
    ? "var(--aegis-primary-surface)"
    : isContext
      ? "rgb(var(--aegis-primary) / 0.08)"
      : "transparent";
  const hoverBg = "rgb(var(--aegis-overlay) / 0.06)";

  return (
    <div
      role="treeitem"
      aria-expanded={isDir ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={0}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        height: 24, // matches ROW_HEIGHT
        paddingRight: 8,
        cursor: "pointer",
        borderRadius: 4,
        margin: "0 4px",
        boxSizing: "border-box",
        userSelect: "none",
        background: isDragging ? "var(--aegis-hover)" : rowBg,
        opacity: isDragging ? 0.55 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLElement).style.background = hoverBg;
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }
      }}
      onClick={() => {
        if (isDir) {
          onToggle(node.path);
        }
        onSelect(node);
      }}
      onContextMenu={(e) => onContextMenu(e, node)}
      onPointerDown={(event) => onPointerDown?.(event, node)}
      draggable={false}
    >
      {/* Indent spacer */}
      <div style={{ width: padLeft, flexShrink: 0 }} />

      {/* Chevron or placeholder */}
      {isDir ? (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.path);
          }}
          style={{
            width: 14,
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--aegis-text-dim)",
            transition: "transform 0.12s ease",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          <ChevronRight size={11} strokeWidth={2} />
        </span>
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}

      {/* Icon */}
      <span
        style={{
          width: 14,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: isDir
            ? "var(--aegis-primary)"
            : node.is_gitignored
              ? "var(--aegis-text-dim)"
              : "var(--aegis-text-muted)",
        }}
      >
        {isDir ? (
          isExpanded ? (
            <FolderOpen size={14} />
          ) : (
            <Folder size={14} />
          )
        ) : (
          <File size={13} />
        )}
      </span>

      {/* Label */}
      <span
        style={{
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          fontFamily: "var(--aegis-body)",
          color: isSelected
            ? "var(--aegis-text)"
            : node.is_gitignored
              ? "var(--aegis-text-dim)"
              : "var(--aegis-text-secondary)",
          fontWeight: isSelected ? 500 : 400,
        }}
      >
        {node.name}
      </span>
    </div>
  );
});
