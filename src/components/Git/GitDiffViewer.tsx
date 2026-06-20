// ── GitDiffViewer — diff display for commits and working-tree files ───────────
// Ported from nezha's GitDiffViewer with --aegis-* CSS var rewrites.
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Columns2, FileCode, Rows3, X } from "lucide-react";
import { DiffFileBlock } from "./DiffFileBlock";
import { parseDiff } from "./parseDiff";
import type { DiffViewMode } from "./types";

const VIEW_MODE_KEY = "junqi.diffViewMode";

// ── i18n fallback ──

const EN: Record<string, string> = {
  "git.diffViewMode": "Diff view mode",
  "git.singleColumnDiff": "Single column diff",
  "git.twoColumnDiff": "Two column diff",
  "git.closeDiff": "Close diff",
  "git.loadingDiff": "Loading diff...",
  "git.noChanges": "No changes",
  "common.fileChanged": "{count} file changed",
  "common.filesChanged": "{count} files changed",
};

function t(key: string, params?: Record<string, string | number>): string {
  const template = EN[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

// ── Props ──

interface Props {
  projectPath: string;
  // "commit" = full commit diff, "file" = working-tree file diff, "commit-file" = single file in a commit
  mode: "commit" | "file" | "commit-file";
  commitHash?: string;
  filePath?: string;
  staged?: boolean;
  title: string;
  onClose: () => void;
}

// ── Sub-components ──

function ViewToggleButton({
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
      aria-label={title}
      aria-pressed={active}
      style={{
        width: 28, height: 28, border: "none", borderRadius: 6,
        cursor: "pointer", display: "inline-flex", alignItems: "center",
        justifyContent: "center", outline: "none",
        background: active ? "var(--aegis-border-hover)" : "transparent",
        color: active ? "var(--aegis-text)" : "var(--aegis-text-dim)",
      }}
    >
      {children}
    </button>
  );
}

// ── Main component ──

export function GitDiffViewer({
  projectPath,
  mode,
  commitHash,
  filePath,
  staged,
  title,
  onClose,
}: Props) {
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      if (stored === "unified" || stored === "split") return stored;
    } catch {}
    return "unified";
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {}
  }, [viewMode]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const loadDiff = async () => {
      try {
        let result: string;
        if (mode === "commit" && commitHash) {
          result = await invoke("git_show_diff", { projectPath, commitHash });
        } else if (mode === "commit-file" && commitHash && filePath !== undefined) {
          result = await invoke("git_show_file_diff", {
            projectPath, commitHash, filePath,
          });
        } else if (mode === "file" && filePath !== undefined) {
          result = await invoke("git_file_diff", {
            projectPath, filePath, staged: staged ?? false,
          });
        } else {
          result = "";
        }
        setDiff(result);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    };

    loadDiff();
  }, [projectPath, mode, commitHash, filePath, staged]);

  const { parsedFiles, totalAdditions, totalDeletions } = useMemo(() => {
    const files = parseDiff(diff, projectPath);
    let add = 0;
    let del = 0;
    for (const f of files) {
      add += f.additions;
      del += f.deletions;
    }
    return { parsedFiles: files, totalAdditions: add, totalDeletions: del };
  }, [diff, projectPath]);

  return (
    <div
      style={{
        flex: 1, display: "flex", flexDirection: "column",
        overflow: "hidden", background: "var(--aegis-elevated)",
      }}
    >
      {/* Header */}
      <div
        style={{
          minHeight: 50, display: "flex", alignItems: "center", gap: 10,
          padding: "0 14px", borderBottom: "1px solid var(--aegis-border)",
          flexShrink: 0, background: "var(--aegis-elevated)",
        }}
      >
        <FileCode size={15} color="var(--aegis-text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5, fontWeight: 700, color: "var(--aegis-text)",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            marginTop: 2, fontSize: 12, color: "var(--aegis-text-dim)",
          }}>
            <span>
              {t(parsedFiles.length === 1 ? "common.fileChanged" : "common.filesChanged", {
                count: parsedFiles.length,
              })}
            </span>
            <span style={{ color: "#3fb950", fontWeight: 650 }}>+{totalAdditions}</span>
            <span style={{ color: "#f85149", fontWeight: 650 }}>-{totalDeletions}</span>
          </div>
        </div>

        {/* View toggle */}
        <div
          role="group"
          aria-label={t("git.diffViewMode")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 2,
            padding: 2, border: "1px solid var(--aegis-border)",
            borderRadius: 8, background: "var(--aegis-card)",
          }}
        >
          <ViewToggleButton
            active={viewMode === "unified"}
            title={t("git.singleColumnDiff")}
            onClick={() => setViewMode("unified")}
          >
            <Rows3 size={15} />
          </ViewToggleButton>
          <ViewToggleButton
            active={viewMode === "split"}
            title={t("git.twoColumnDiff")}
            onClick={() => setViewMode("split")}
          >
            <Columns2 size={15} />
          </ViewToggleButton>
        </div>

        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          title={t("git.closeDiff")}
          aria-label={t("git.closeDiff")}
          style={{
            width: 28, height: 28, background: "transparent",
            border: "none", cursor: "pointer", borderRadius: 6,
            color: "var(--aegis-text-dim)", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
        {loading ? (
          <div
            style={{
              padding: 24, color: "var(--aegis-text-dim)",
              fontSize: 13, textAlign: "center",
            }}
          >
            {t("git.loadingDiff")}
          </div>
        ) : error ? (
          <div style={{ padding: 24, color: "rgb(var(--aegis-danger))", fontSize: 13 }}>
            {error}
          </div>
        ) : diff.trim() === "" ? (
          <div
            style={{
              padding: 24, color: "var(--aegis-text-dim)",
              fontSize: 13, textAlign: "center",
            }}
          >
            {t("git.noChanges")}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: "100%" }}>
            {parsedFiles.map((file, index) => (
              <DiffFileBlock
                key={`${file.displayPath}-${index}`}
                file={file}
                viewMode={viewMode}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
