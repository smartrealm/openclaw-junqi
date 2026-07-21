// ── DiffFileBlock — renders a single file's diff in unified or split view ─────
// Ported from junqi's git-diff/DiffFileBlock with --aegis-* CSS var rewrites.
import { useState, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DiffFile, DiffViewMode } from "./types";
import { getGitStatusColor, getGitStatusLabel, fileName } from "./types";

interface Props {
  file: DiffFile;
  viewMode: DiffViewMode;
}

export function DiffFileBlock({ file, viewMode }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const statusLabel = getGitStatusLabel(file.status);
  const statusColor = getGitStatusColor(file.status);
  const displayName = fileName(file.displayPath);
  const dirPath =
    file.displayPath.includes("/")
      ? file.displayPath.slice(0, file.displayPath.lastIndexOf("/"))
      : "";

  return (
    <div
      style={{
        border: "1px solid var(--aegis-border)",
        borderRadius: 9,
        overflow: "hidden",
        background: "var(--aegis-elevated)",
      }}
    >
      {/* File header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          height: 38,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          background: "var(--aegis-card)",
          border: "none",
          borderBottom: collapsed ? "none" : "1px solid var(--aegis-border)",
          cursor: "pointer",
          userSelect: "none",
          width: "100%",
          textAlign: "left",
          outline: "none",
          color: "var(--aegis-text)",
          fontFamily: "inherit",
        }}
      >
        {collapsed ? (
          <ChevronRight size={14} color="var(--aegis-text-dim)" />
        ) : (
          <ChevronDown size={14} color="var(--aegis-text-dim)" />
        )}
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.2,
            background: "none",
            border: `1.5px solid ${statusColor}`,
            color: statusColor,
            flexShrink: 0,
          }}
        >
          {statusLabel}
        </span>
        <span style={{ fontSize: 13, fontWeight: 650 }}>
          {displayName}
        </span>
        {dirPath && (
          <span style={{ fontSize: 12, color: "var(--aegis-text-dim)" }}>
            {dirPath}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--aegis-text-dim)" }}>
          +{file.additions} -{file.deletions}
        </span>
      </button>

      {!collapsed && (
        <div style={{ overflowX: "auto" }}>
          {file.binary ? (
            <div
              style={{
                padding: "12px 14px",
                color: "var(--aegis-text-dim)",
                fontSize: 12.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              Binary file not shown
            </div>
          ) : file.hunks.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                color: "var(--aegis-text-dim)",
                fontSize: 12.5,
                fontFamily: "var(--font-mono)",
              }}
            >
              No textual changes
            </div>
          ) : viewMode === "unified" ? (
            <UnifiedView file={file} />
          ) : (
            <SplitView file={file} />
          )}
        </div>
      )}
    </div>
  );
}

// ── Unified diff view ──

function UnifiedView({ file }: { file: DiffFile }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: "22px" }}>
      {file.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header */}
          <div
            style={{
              minHeight: 24,
              lineHeight: "24px",
              background: "var(--aegis-hover)",
              color: "var(--aegis-text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              borderTop: hi > 0 ? "1px solid var(--aegis-border)" : "none",
              borderBottom: "1px solid var(--aegis-border)",
              padding: "0 12px",
            }}
          >
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              style={{
                display: "flex",
                background: line.kind === "add"
                  ? "rgba(63, 185, 80, 0.1)"
                  : line.kind === "delete"
                  ? "rgba(248, 81, 73, 0.1)"
                  : "transparent",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 40,
                  textAlign: "right",
                  padding: "0 10px",
                  color: "var(--aegis-text-dim)",
                  background: "var(--aegis-card)",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {line.oldLineNo ?? " "}
              </span>
              <span
                style={{
                  display: "inline-block",
                  width: 40,
                  textAlign: "right",
                  padding: "0 10px",
                  color: "var(--aegis-text-dim)",
                  background: "var(--aegis-card)",
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                {line.newLineNo ?? " "}
              </span>
              <span
                style={{
                  textAlign: "center",
                  width: 20,
                  flexShrink: 0,
                  color: line.kind === "add"
                    ? "#3fb950"
                    : line.kind === "delete"
                    ? "#f85149"
                    : "var(--aegis-text-dim)",
                  userSelect: "none",
                }}
              >
                {line.kind === "add" ? "+" : line.kind === "delete" ? "-" : " "}
              </span>
              <span
                style={{
                  whiteSpace: "pre",
                  padding: "0 14px 0 8px",
                  color: "var(--aegis-text)",
                  flex: 1,
                }}
              >
                {line.text}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Split diff view ──

function SplitView({ file }: { file: DiffFile }) {
  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      {file.hunks.map((hunk, hi) => (
        <div key={hi}>
          {/* Hunk header spans both columns */}
          <div
            style={{
              minHeight: 22,
              lineHeight: "22px",
              padding: "0 12px",
              color: "var(--aegis-text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 12.5,
              background: "var(--aegis-hover)",
              borderTop: hi > 0 ? "1px solid var(--aegis-border)" : "none",
              borderBottom: "1px solid var(--aegis-border)",
            }}
          >
            {hunk.header}
          </div>
          <div style={{ display: "flex" }}>
            {/* Left side: old/deleted */}
            <div style={{ flex: 1, minWidth: 0, borderRight: "1px solid var(--aegis-border)" }}>
              {hunk.lines.map((line, li) => (
                <div
                  key={`l-${li}`}
                  style={{
                    display: "flex",
                    minHeight: 22,
                    background:
                      line.kind === "delete"
                        ? "rgba(248, 81, 73, 0.12)"
                        : line.kind === "add"
                        ? "var(--aegis-card)"
                        : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      textAlign: "right",
                      padding: "0 10px",
                      color: "var(--aegis-text-dim)",
                      background: "var(--aegis-card)",
                      userSelect: "none",
                      flexShrink: 0,
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "add" ? "" : line.oldLineNo ?? ""}
                  </span>
                  <span
                    style={{
                      textAlign: "center",
                      width: 16,
                      flexShrink: 0,
                      color: line.kind === "delete" ? "#f85149" : "var(--aegis-text-dim)",
                      userSelect: "none",
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "delete" ? "-" : ""}
                  </span>
                  <span
                    style={{
                      whiteSpace: "pre",
                      padding: "0 8px",
                      color: line.kind === "add" ? "transparent" : "var(--aegis-text)",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "add" ? "" : line.text}
                  </span>
                </div>
              ))}
            </div>
            {/* Right side: new/added */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {hunk.lines.map((line, li) => (
                <div
                  key={`r-${li}`}
                  style={{
                    display: "flex",
                    minHeight: 22,
                    background:
                      line.kind === "add"
                        ? "rgba(63, 185, 80, 0.1)"
                        : line.kind === "delete"
                        ? "var(--aegis-card)"
                        : "transparent",
                  }}
                >
                  <span
                    style={{
                      width: 40,
                      textAlign: "right",
                      padding: "0 10px",
                      color: "var(--aegis-text-dim)",
                      background: "var(--aegis-card)",
                      userSelect: "none",
                      flexShrink: 0,
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "delete" ? "" : line.newLineNo ?? ""}
                  </span>
                  <span
                    style={{
                      textAlign: "center",
                      width: 16,
                      flexShrink: 0,
                      color: line.kind === "add" ? "#3fb950" : "var(--aegis-text-dim)",
                      userSelect: "none",
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "add" ? "+" : ""}
                  </span>
                  <span
                    style={{
                      whiteSpace: "pre",
                      padding: "0 8px",
                      color: line.kind === "delete" ? "transparent" : "var(--aegis-text)",
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      lineHeight: "22px",
                    }}
                  >
                    {line.kind === "delete" ? "" : line.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
