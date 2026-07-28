import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Filter,
  GitCommit,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Undo2,
  X,
} from "lucide-react";
import { useVisibleInterval } from "@/hooks/useVisibleInterval";
import {
  createCoalescedAsyncRunner,
  type CoalescedAsyncRunner,
} from "@/utils/coalescedAsyncRunner";
import {
  GitFileBrowser,
  GitFileViewToggle,
  useGitFileViewMode,
} from "./GitFileBrowser";
import {
  type GitFileChange,
  type GitDirectoryActionTarget,
  fileName,
} from "./types";
import { filterGitChanges } from "./gitChangesModel";
import { useCancellableInvoke } from "./useCancellableInvoke";

const GIT_STATUS_REFRESH_MS = 3000;

// ── Props ──

interface Props {
  projectPath: string;
  onFileSelect: (filePath: string, staged: boolean, label: string) => void;
  width?: number;
}

// ── Sub-components ──

function TopSectionHeader({
  label,
  count,
  collapsed,
  onToggleCollapse,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggleCollapse}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 10px 6px 8px",
        cursor: "pointer",
        background: hovered ? "var(--aegis-hover)" : "transparent",
        transition: "background 0.1s",
        userSelect: "none",
      }}
    >
      <span style={{ color: "var(--aegis-text-dim)", display: "flex", alignItems: "center", marginRight: 4 }}>
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
      </span>
      <span style={{ flex: 1, fontSize: 12, fontWeight: 650, color: "var(--aegis-text)" }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 600, color: "var(--aegis-text-dim)",
        background: "var(--aegis-card)", border: "1px solid var(--aegis-border)",
        borderRadius: 10, padding: "0 6px", minWidth: 18, textAlign: "center",
      }}>
        {count}
      </span>
    </div>
  );
}

function SectionHeader({
  label,
  count,
  actionIcon,
  actionTitle,
  onAction,
}: {
  label: string;
  count: number;
  actionIcon?: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "6px 8px 2px 12px",
        fontSize: 11,
        fontWeight: 700,
        color: "var(--aegis-text-dim)",
        letterSpacing: 0.4,
        textTransform: "uppercase",
      }}
    >
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--aegis-text-dim)", marginRight: onAction ? 4 : 0 }}>
        {count}
      </span>
      {onAction && (
        <button
          onClick={(e) => { e.stopPropagation(); onAction(); }}
          title={actionTitle}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: "2px 5px", borderRadius: 4, fontSize: 14, lineHeight: 1,
            color: hovered ? "var(--aegis-text)" : "transparent",
            transition: "color 0.1s", fontWeight: 600,
          }}
        >
          {actionIcon}
        </button>
      )}
    </div>
  );
}

// ── Main component ──

export function GitChanges({
  projectPath,
  onFileSelect,
  width = 280,
}: Props) {
  const { t } = useTranslation();
  const [changes, setChanges] = useState<GitFileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [commitMsgError, setCommitMsgError] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [trackedCollapsed, setTrackedCollapsed] = useState(false);
  const [untrackedCollapsed, setUntrackedCollapsed] = useState(false);
  const [fileViewMode, setFileViewMode] = useGitFileViewMode();
  const filterInputRef = useRef<HTMLInputElement>(null);
  const projectPathRef = useRef(projectPath);
  const refreshTaskRef = useRef<() => Promise<void>>(async () => undefined);
  const refreshRunnerRef = useRef<CoalescedAsyncRunner | null>(null);

  const { safeInvoke, isCancelled } = useCancellableInvoke();
  projectPathRef.current = projectPath;
  const isCurrentProject = (requestPath: string) => (
    !isCancelled() && projectPathRef.current === requestPath
  );

  refreshTaskRef.current = async () => {
    const requestPath = projectPathRef.current;
    try {
      const result = await safeInvoke<GitFileChange[]>("git_status", {
        projectPath: requestPath,
      });
      if (result === null || projectPathRef.current !== requestPath) return;
      setChanges(result);
      setRefreshError(null);
    } catch (refreshError) {
      if (!isCancelled() && projectPathRef.current === requestPath) {
        setRefreshError(String(refreshError));
      }
    }
  };
  if (!refreshRunnerRef.current) {
    refreshRunnerRef.current = createCoalescedAsyncRunner(
      () => refreshTaskRef.current(),
    );
  }

  const refresh = useCallback((options?: { clearError?: boolean }) => {
    if (options?.clearError !== false) {
      setError(null);
      setRefreshError(null);
    }
    const runner = refreshRunnerRef.current;
    if (!runner) return Promise.resolve();
    if (!runner.isRunning()) setLoading(true);
    return runner.run().finally(() => {
      if (!isCancelled() && !runner.isRunning()) setLoading(false);
    });
  }, [isCancelled]);

  useEffect(() => {
    setChanges([]);
    setError(null);
    setRefreshError(null);
    setFilterQuery("");
    setFilterOpen(false);
    setCommitMsg("");
    setCommitMsgError(false);
    setCommitting(false);
    setGeneratingMsg(false);
  }, [projectPath]);
  useVisibleInterval(
    () => void refresh({ clearError: false }),
    GIT_STATUS_REFRESH_MS,
    true,
    projectPath,
  );

  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus();
  }, [filterOpen]);

  const displayed = useMemo(
    () => filterGitChanges(changes, filterQuery),
    [changes, filterQuery],
  );

  const trackedFiles = useMemo(() => displayed.filter((c) => c.status !== "?"), [displayed]);
  const untrackedFiles = useMemo(() => displayed.filter((c) => c.status === "?"), [displayed]);
  const stagedFiles = useMemo(() => trackedFiles.filter((c) => c.staged), [trackedFiles]);
  const unstagedFiles = useMemo(() => trackedFiles.filter((c) => !c.staged), [trackedFiles]);

  const handleStageToggle = async (c: GitFileChange, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const requestPath = projectPath;
    try {
      if (c.staged) {
        await invoke("git_unstage", { projectPath: requestPath, filePath: c.path });
      } else {
        await invoke("git_stage", { projectPath: requestPath, filePath: c.path });
      }
      if (!isCurrentProject(requestPath)) return;
      await refresh();
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    }
  };

  const handleDirectoryStageToggle = async (
    directory: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const requestPath = projectPath;
    try {
      setError(null);
      if (directory.staged) {
        await invoke("git_unstage_files", { projectPath: requestPath, filePaths: directory.filePaths });
      } else {
        await invoke("git_stage_files", { projectPath: requestPath, filePaths: directory.filePaths });
      }
      if (!isCurrentProject(requestPath)) return;
      await refresh();
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    }
  };

  const handleStageAll = async () => {
    const requestPath = projectPath;
    try {
      setError(null);
      await invoke("git_stage_all", { projectPath: requestPath });
      if (!isCurrentProject(requestPath)) return;
      await refresh();
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    }
  };

  const handleUnstageAll = async () => {
    const requestPath = projectPath;
    try {
      setError(null);
      await invoke("git_unstage_all", { projectPath: requestPath });
      if (!isCurrentProject(requestPath)) return;
      await refresh();
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    }
  };

  const handleDiscardFile = async (c: GitFileChange, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const requestPath = projectPath;
    const untracked = c.status === "?";
    const name = fileName(c.path);
    const ok = await confirm(
      t(untracked ? "gitChanges.confirmDiscardUntracked" : "gitChanges.confirmDiscardTracked", { name }),
      {
        title: t("gitChanges.confirmDiscardTitle", { name }),
        kind: "warning",
        okLabel: t("gitChanges.discard"),
      },
    );
    if (!ok || !isCurrentProject(requestPath)) return;
    try {
      setError(null);
      await invoke("git_discard_file", { projectPath: requestPath, filePath: c.path, untracked });
    } catch (err) {
      if (isCurrentProject(requestPath)) {
        setError(t("gitChanges.discardFailed", { error: String(err) }));
      }
    } finally {
      if (isCurrentProject(requestPath)) await refresh({ clearError: false });
    }
  };

  const handleDiscardDirectory = async (
    directory: GitDirectoryActionTarget,
    e: React.MouseEvent,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const requestPath = projectPath;
    const ok = await confirm(
      t(directory.untracked ? "gitChanges.confirmDiscardUntracked" : "gitChanges.confirmDiscardTracked", {
        name: directory.name,
      }),
      {
        title: t("gitChanges.confirmDiscardTitle", { name: directory.name }),
        kind: "warning",
        okLabel: t("gitChanges.discard"),
      },
    );
    if (!ok || !isCurrentProject(requestPath)) return;
    try {
      setError(null);
      await invoke("git_discard_files", {
        projectPath: requestPath,
        filePaths: directory.filePaths,
        untracked: directory.untracked,
      });
    } catch (err) {
      if (isCurrentProject(requestPath)) {
        setError(t("gitChanges.discardFailed", { error: String(err) }));
      }
    } finally {
      if (isCurrentProject(requestPath)) await refresh({ clearError: false });
    }
  };

  const handleDiscardAll = async () => {
    const requestPath = projectPath;
    const ok = await confirm(t("gitChanges.confirmDiscardAll"), {
      title: t("gitChanges.confirmDiscardAllTitle"),
      kind: "warning",
      okLabel: t("gitChanges.discardAll"),
    });
    if (!ok || !isCurrentProject(requestPath)) return;
    try {
      setError(null);
      await invoke("git_discard_all", { projectPath: requestPath });
    } catch (err) {
      if (isCurrentProject(requestPath)) {
        setError(t("gitChanges.discardFailed", { error: String(err) }));
      }
    } finally {
      if (isCurrentProject(requestPath)) await refresh({ clearError: false });
    }
  };

  const handleGenerateMsg = async () => {
    const requestPath = projectPath;
    setGeneratingMsg(true);
    setError(null);
    try {
      const msg = await safeInvoke<string>("generate_commit_message", { projectPath: requestPath });
      if (msg === null || !isCurrentProject(requestPath)) return;
      setCommitMsg(msg);
      if (commitMsgError) setCommitMsgError(false);
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    } finally {
      if (isCurrentProject(requestPath)) setGeneratingMsg(false);
    }
  };

  const handleCommit = async () => {
    if (!commitMsg.trim()) {
      setCommitMsgError(true);
      return;
    }
    setCommitMsgError(false);
    setCommitting(true);
    setError(null);
    const requestPath = projectPath;
    try {
      await invoke("git_commit", { projectPath: requestPath, message: commitMsg.trim() });
      if (!isCurrentProject(requestPath)) return;
      setCommitMsg("");
      await refresh();
    } catch (err) {
      if (isCurrentProject(requestPath)) setError(String(err));
    } finally {
      if (isCurrentProject(requestPath)) setCommitting(false);
    }
  };

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        background: "var(--aegis-surface)",
        borderLeft: "1px solid var(--aegis-border)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          display: "flex",
          alignItems: "center",
          padding: "0 12px",
          borderBottom: "1px solid var(--aegis-border)",
          flexShrink: 0,
          gap: 6,
        }}
      >
        <span style={{ flex: 1, fontSize: 13, fontWeight: 650, color: "var(--aegis-text)" }}>
          {t("gitChanges.title")}
        </span>
        <span
          style={{
            minWidth: 20,
            padding: "0 6px",
            borderRadius: 10,
            background: "var(--aegis-card)",
            border: "1px solid var(--aegis-border)",
            color: "var(--aegis-text-dim)",
            fontSize: 10.5,
            textAlign: "center",
          }}
        >
          {changes.length}
        </span>
        <button
          type="button"
          onClick={() => void refresh()}
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 4, borderRadius: 4, color: "var(--aegis-text-dim)",
            display: "flex", alignItems: "center",
          }}
        >
          <RefreshCw size={13} className={loading ? "spin" : ""} />
        </button>
        <button
          type="button"
          onClick={() => void handleDiscardAll()}
          disabled={changes.length === 0}
          title={t("gitChanges.discardAll")}
          aria-label={t("gitChanges.discardAll")}
          style={{
            background: "none", border: "none", cursor: changes.length === 0 ? "default" : "pointer",
            padding: 4, borderRadius: 4, color: "var(--aegis-text-dim)",
            display: "flex", alignItems: "center",
            opacity: changes.length === 0 ? 0.4 : 1,
          }}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (filterOpen) setFilterQuery("");
            setFilterOpen((open) => !open);
          }}
          title={t("gitChanges.filter")}
          aria-label={t("gitChanges.filter")}
          aria-pressed={filterOpen}
          style={{
            background: filterOpen ? "var(--aegis-border-hover)" : "none",
            border: "none", cursor: "pointer",
            padding: 4, borderRadius: 4,
            color: filterOpen ? "var(--aegis-text)" : "var(--aegis-text-dim)",
            display: "flex", alignItems: "center",
          }}
        >
          <Filter size={13} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", flexShrink: 0 }}>
        {filterOpen ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minWidth: 0,
              flex: 1,
              height: 28,
              padding: "0 7px",
              border: "1px solid var(--aegis-border)",
              borderRadius: 5,
              background: "var(--aegis-bg)",
            }}
          >
            <Filter size={12} style={{ flexShrink: 0, color: "var(--aegis-text-dim)" }} />
            <input
              ref={filterInputRef}
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setFilterQuery("");
                  setFilterOpen(false);
                }
              }}
              placeholder={t("gitChanges.filterPlaceholder")}
              aria-label={t("gitChanges.filterPlaceholder")}
              style={{
                minWidth: 0,
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                padding: "0 6px",
                color: "var(--aegis-text)",
                fontSize: 11.5,
              }}
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery("")}
                title={t("gitChanges.clearFilter")}
                aria-label={t("gitChanges.clearFilter")}
                style={{
                  display: "flex",
                  padding: 2,
                  border: "none",
                  background: "transparent",
                  color: "var(--aegis-text-dim)",
                  cursor: "pointer",
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ) : (
          <span style={{ flex: 1, fontSize: 10.5, color: "var(--aegis-text-dim)" }}>
            {t("gitChanges.workspaceScope")}
          </span>
        )}
        <div style={{ marginLeft: "auto", flexShrink: 0 }}>
          <GitFileViewToggle mode={fileViewMode} onChange={setFileViewMode} />
        </div>
      </div>

      {/* Error */}
      {(error || refreshError) && (
        <div
          style={{
            margin: "0 12px 4px", padding: "6px 10px",
            background: "var(--aegis-danger-surface)",
            border: "1px solid rgb(var(--aegis-danger) / 0.25)",
            borderRadius: 6, fontSize: 11.5,
            color: "rgb(var(--aegis-danger))",
          }}
        >
          {error || refreshError}
        </div>
      )}

      {/* File list */}
      <div
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        {displayed.length === 0 && !loading && (
          <div style={{ padding: "24px 16px", fontSize: 12, color: "var(--aegis-text-dim)", textAlign: "center" }}>
            {filterQuery.trim()
              ? t("gitChanges.noMatchingChanges")
              : t("gitChanges.noChanges")}
          </div>
        )}

        {/* Tracked changes section */}
        {trackedFiles.length > 0 && (
          <>
            <TopSectionHeader
              label={t("gitChanges.title")}
              count={trackedFiles.length}
              collapsed={trackedCollapsed}
              onToggleCollapse={() => setTrackedCollapsed((v) => !v)}
            />
            {!trackedCollapsed && (
              <>
                {stagedFiles.length > 0 && (
                  <>
                    <SectionHeader
                      label={t("gitChanges.staged")}
                      count={stagedFiles.length}
                      actionIcon="-"
                      actionTitle={t("gitChanges.unstageAll")}
                      onAction={handleUnstageAll}
                    />
                    <GitFileBrowser
                      entries={stagedFiles}
                      mode={fileViewMode}
                      onFileClick={(c) =>
                        onFileSelect(c.path, true, `${fileName(c.path)} (${t("gitChanges.staged")})`)
                      }
                      onStageToggle={handleStageToggle}
                      onDirectoryStageToggle={handleDirectoryStageToggle}
                    />
                  </>
                )}
                {unstagedFiles.length > 0 && (
                  <>
                    <SectionHeader
                      label={t("gitChanges.modified")}
                      count={unstagedFiles.length}
                      actionIcon="+"
                      actionTitle={t("gitChanges.stageAll")}
                      onAction={handleStageAll}
                    />
                    <GitFileBrowser
                      entries={unstagedFiles}
                      mode={fileViewMode}
                      onFileClick={(c) =>
                        onFileSelect(c.path, false, `${fileName(c.path)} (${t("gitChanges.unstaged")})`)
                      }
                      onStageToggle={handleStageToggle}
                      onDirectoryStageToggle={handleDirectoryStageToggle}
                      onDiscard={handleDiscardFile}
                      onDirectoryDiscard={handleDiscardDirectory}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* Untracked files section */}
        {untrackedFiles.length > 0 && (
          <>
            <TopSectionHeader
              label={t("gitChanges.untrackedFiles")}
              count={untrackedFiles.length}
              collapsed={untrackedCollapsed}
              onToggleCollapse={() => setUntrackedCollapsed((v) => !v)}
            />
            {!untrackedCollapsed && (
              <GitFileBrowser
                entries={untrackedFiles}
                mode={fileViewMode}
                onFileClick={(c) => onFileSelect(c.path, false, `${fileName(c.path)} (${t("gitChanges.untracked")})`)}
                onStageToggle={handleStageToggle}
                onDirectoryStageToggle={handleDirectoryStageToggle}
                onDiscard={handleDiscardFile}
                onDirectoryDiscard={handleDiscardDirectory}
              />
            )}
          </>
        )}
      </div>

      {/* Commit area */}
      <div style={{ padding: "8px 10px", borderTop: "1px solid var(--aegis-border)", flexShrink: 0 }}>
        <div style={{ position: "relative" }}>
          <textarea
            value={commitMsg}
            onChange={(e) => {
              setCommitMsg(e.target.value);
              if (commitMsgError) setCommitMsgError(false);
            }}
            onFocus={() => setTextareaFocused(true)}
            onBlur={() => setTextareaFocused(false)}
            placeholder={t("gitChanges.commitMessage")}
            rows={3}
            style={{
              width: "100%",
              padding: "8px 10px",
              paddingRight: 36,
              background: "var(--aegis-card)",
              border: `1px solid ${commitMsgError ? "rgb(var(--aegis-danger))" : textareaFocused ? "var(--aegis-border-active)" : "var(--aegis-border)"}`,
              borderRadius: 6,
              color: "var(--aegis-text)",
              fontSize: 12.5,
              resize: "none",
              outline: "none",
              fontFamily: "var(--font-sans)",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCommit();
            }}
          />
          <button
            onClick={handleGenerateMsg}
            disabled={generatingMsg}
            title={t("gitChanges.generateCommitMessage")}
            style={{
              position: "absolute", top: 6, right: 6,
              background: "none", border: "none",
              cursor: generatingMsg ? "default" : "pointer",
              padding: 3, borderRadius: 4,
              color: generatingMsg ? "rgb(var(--aegis-accent))" : "var(--aegis-text-dim)",
              display: "flex", alignItems: "center",
              transition: "color 0.15s",
            }}
          >
            <Sparkles size={14} className={generatingMsg ? "spin" : ""} />
          </button>
        </div>
        {commitMsgError && (
          <div style={{ fontSize: 11.5, color: "rgb(var(--aegis-danger))", marginTop: 3, paddingLeft: 2 }}>
            {t("gitChanges.enterCommitMessage")}
          </div>
        )}
        <div style={{ marginTop: 3, display: "flex" }}>
          <button
            onClick={handleCommit}
            disabled={committing || generatingMsg}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 12px",
              background: "rgb(var(--aegis-accent))",
              color: "var(--aegis-btn-primary-text)",
              border: "none", borderRadius: 6,
              fontSize: 12.5, fontWeight: 600,
              cursor: committing || generatingMsg ? "default" : "pointer",
              opacity: committing || generatingMsg ? 0.7 : 1,
            }}
          >
            <GitCommit size={13} />
            {committing ? t("gitChanges.committing") : t("gitChanges.commit")}
          </button>
        </div>
      </div>
    </div>
  );
}

export { type GitFileChange };
