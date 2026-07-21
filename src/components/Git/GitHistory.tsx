// ── GitHistory — commit log browser ───────────────────────────────────────────
// Ported from junqi's GitHistory with --aegis-* CSS var rewrites.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Search,
  RefreshCw,
  Filter,
  GitCommit as GitCommitIcon,
  GitBranch as GitBranchIcon,
  Loader2,
  ChevronDown,
  Check,
  X,
} from "lucide-react";
import {
  GitFileBrowser,
  GitFileViewToggle,
  useGitFileViewMode,
} from "./GitFileBrowser";
import type {
  GitCommit,
  GitCommitFile,
  GitCommitDetail,
  GitRemoteCounts,
  GitBranchInfo,
} from "./types";

// ── i18n fallback ──

const EN: Record<string, string> = {
  "git.history": "History",
  "git.pull": "Pull",
  "git.push": "Push",
  "git.pushing": "Pushing...",
  "git.searchCommits": "Search commits",
  "git.noCommitsFound": "No commits found",
  "git.loadingDiff": "Loading diff...",
  "git.closeDiff": "Close diff",
  "common.refresh": "Refresh",
  "common.loadingEllipsis": "Loading...",
  "common.reset": "Reset",
  "common.fileChanged": "{count} file changed",
  "common.filesChanged": "{count} files changed",
  "branch.searchBranches": "Search branches...",
  "branch.noBranchesFound": "No branches found",
};

function t(key: string, params?: Record<string, string | number>): string {
  const template = EN[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
}

// ── Cancellable invoke hook ──

function useCancellableInvoke() {
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => { cancelledRef.current = true; };
  }, []);

  const safeInvoke = useCallback(
    async <T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | null> => {
      const result = await invoke<T>(cmd, args);
      if (cancelledRef.current) return null;
      return result;
    },
    [],
  );

  const isCancelled = useCallback(() => cancelledRef.current, []);
  return { safeInvoke, isCancelled };
}

// ── Props ──

interface Props {
  projectPath: string;
  onCommitSelect: (hash: string, message: string) => void;
  onFileClick?: (hash: string, filePath: string, label: string) => void;
  width?: number;
}

// ── Sub-components ──

function CommitRow({
  commit,
  isSelected,
  onClick,
}: {
  commit: GitCommit;
  isSelected: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const hasBranch = commit.refs.some((r) => !r.startsWith("tag:") && !r.includes("HEAD"));
  const branchNames = commit.refs
    .filter((r) => !r.startsWith("tag:") && !r.includes("HEAD ->"))
    .map((r) => r.trim());

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 12px",
        cursor: "pointer",
        background: isSelected
          ? "var(--aegis-primary-surface)"
          : hovered
          ? "var(--aegis-hover)"
          : "transparent",
        transition: "background 0.1s",
        borderLeft: isSelected ? "2px solid rgb(var(--aegis-accent))" : "2px solid transparent",
      }}
    >
      {/* Dot indicator */}
      <div style={{ flexShrink: 0, marginTop: 3 }}>
        <div
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: isSelected
              ? "rgb(var(--aegis-accent))"
              : hasBranch
              ? "var(--aegis-text-muted)"
              : "var(--aegis-text-dim)",
            border: isSelected
              ? "none"
              : `2px solid ${hasBranch ? "var(--aegis-text-muted)" : "var(--aegis-border-hover)"}`,
          }}
        />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
          <span style={{
            fontSize: 12.5, fontWeight: 500, color: "var(--aegis-text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {commit.message}
          </span>
          {branchNames.map((ref) => (
            <span key={ref} style={{
              fontSize: 10.5, fontWeight: 600, padding: "1px 6px",
              borderRadius: 4, background: "var(--aegis-hover)",
              color: "var(--aegis-text-muted)", flexShrink: 0, whiteSpace: "nowrap",
            }}>
              {ref}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <span style={{ fontSize: 10.5, color: "var(--aegis-text-dim)", fontFamily: "var(--font-mono)" }}>
            {commit.short_hash}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--aegis-text-dim)" }}>{commit.author}</span>
          <span style={{ fontSize: 10.5, color: "var(--aegis-text-dim)" }}>{commit.date}</span>
        </div>
      </div>
    </div>
  );
}

function BranchOption({
  name,
  current,
  active,
  onClick,
}: {
  name: string;
  current: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "6px 10px", cursor: "pointer",
        background: hovered || active ? "var(--aegis-hover)" : "transparent",
        transition: "background 0.1s",
      }}
    >
      <GitBranchIcon
        size={11}
        color={active ? "rgb(var(--aegis-accent))" : "var(--aegis-text-dim)"}
        style={{ flexShrink: 0 }}
      />
      <span style={{
        flex: 1, fontSize: 12,
        color: active ? "rgb(var(--aegis-accent))" : "var(--aegis-text)",
        fontWeight: active ? 600 : 400,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {name}
      </span>
      {current && (
        <span style={{ fontSize: 10, color: "var(--aegis-text-dim)", flexShrink: 0 }}>HEAD</span>
      )}
      {active && <Check size={11} color="rgb(var(--aegis-accent))" style={{ flexShrink: 0 }} />}
    </div>
  );
}

function CommitDetailPanel({
  detail,
  loading,
  onFileClick,
}: {
  detail: GitCommitDetail;
  loading: boolean;
  onFileClick?: (path: string) => void;
}) {
  const [fileViewMode, setFileViewMode] = useGitFileViewMode();

  if (loading) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: "var(--aegis-text-dim)" }}>
        {t("common.loadingEllipsis")}
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", flex: 1 }}>
      {/* Commit meta */}
      <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--aegis-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <GitCommitIcon size={12} color="var(--aegis-text-dim)" />
          <span style={{ fontSize: 11, color: "var(--aegis-text-dim)", fontFamily: "var(--font-mono)" }}>
            {detail.short_hash}
          </span>
          <span style={{ fontSize: 11, color: "var(--aegis-text-dim)" }}>{detail.author}</span>
          <span style={{ fontSize: 11, color: "var(--aegis-text-dim)", marginLeft: "auto" }}>
            {detail.date}
          </span>
        </div>
        <div style={{
          fontSize: 12.5, color: "var(--aegis-text)", fontWeight: 500,
          lineHeight: 1.4, marginBottom: 4,
        }}>
          {detail.message}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, fontSize: 11, color: "var(--aegis-text-dim)" }}>
            {t(detail.files.length === 1 ? "common.fileChanged" : "common.filesChanged", {
              count: detail.files.length,
            })}{" "}
            <span style={{ color: "#3fb950" }}>+{detail.total_additions}</span>{" "}
            <span style={{ color: "#f85149" }}>-{detail.total_deletions}</span>
          </div>
          <GitFileViewToggle mode={fileViewMode} onChange={setFileViewMode} />
        </div>
      </div>

      {/* File list */}
      <GitFileBrowser
        entries={detail.files}
        mode={fileViewMode}
        showStats
        onFileClick={onFileClick ? (f) => onFileClick(f.path) : undefined}
      />
    </div>
  );
}

// ── Main component ──

export function GitHistory({ projectPath, onCommitSelect, onFileClick, width = 280 }: Props) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [remoteCounts, setRemoteCounts] = useState<GitRemoteCounts>({
    ahead: 0, behind: 0, branch: "",
  });
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<GitCommitDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchSearch, setBranchSearch] = useState("");
  const branchDropRef = useRef<HTMLDivElement>(null);

  const { safeInvoke, isCancelled } = useCancellableInvoke();

  const filteredBranches = useMemo(() => {
    const query = branchSearch.trim().toLowerCase();
    if (!query) return branches;
    return branches.filter((branch) => branch.name.toLowerCase().includes(query));
  }, [branches, branchSearch]);

  useEffect(() => {
    if (!branchOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (!branchDropRef.current?.contains(e.target as Node)) {
        setBranchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [branchOpen]);

  const loadBranches = useCallback(async () => {
    try {
      const list = await safeInvoke<GitBranchInfo[]>("git_list_branches", { projectPath });
      if (list === null) return;
      setBranches(list);
      setSelectedBranch((prev) => {
        if (prev) return prev;
        return list.find((b: GitBranchInfo) => b.current)?.name ?? "";
      });
    } catch {
      // ignore
    }
  }, [projectPath, safeInvoke]);

  const refresh = useCallback(
    async (query?: string, branch?: string) => {
      setLoading(true);
      setError(null);
      const activeBranch = branch ?? selectedBranch;
      try {
        const [log, remote] = (await Promise.all([
          safeInvoke<GitCommit[]>("git_log", {
            projectPath,
            limit: 50,
            search: query ?? searchQuery,
            branch: activeBranch || null,
          }),
          safeInvoke<GitRemoteCounts>("git_remote_counts", {
            projectPath,
            branch: activeBranch || null,
          }).catch(() => ({ ahead: 0, behind: 0, branch: "" })),
        ])) as [GitCommit[] | null, GitRemoteCounts | { ahead: number; behind: number; branch: string }];
        if (log === null) return;
        setCommits(log);
        setRemoteCounts((remote as GitRemoteCounts) ?? { ahead: 0, behind: 0, branch: "" });
      } catch (e) {
        if (!isCancelled()) setError(String(e));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [projectPath, searchQuery, selectedBranch, safeInvoke, isCancelled],
  );

  useEffect(() => {
    setSelectedBranch("");
    setBranchSearch("");
    loadBranches();
    setSelectedHash(null);
    setSelectedDetail(null);
  }, [projectPath, loadBranches]);

  useEffect(() => {
    if (selectedBranch !== "") {
      refresh(undefined, selectedBranch);
    }
  }, [refresh, selectedBranch]);

  const handleSearch = useCallback(
    (q: string) => {
      setSearchQuery(q);
      refresh(q);
    },
    [refresh],
  );

  const handleSelectCommit = useCallback(
    async (commit: GitCommit) => {
      setSelectedHash(commit.hash);
      onCommitSelect(commit.hash, commit.message);
      setLoadingDetail(true);
      try {
        const detail = await safeInvoke<GitCommitDetail>("git_commit_detail", {
          projectPath,
          commitHash: commit.hash,
        }) as GitCommitDetail | null;
        if (detail === null) return;
        setSelectedDetail(detail);
      } catch {
        if (!isCancelled()) setSelectedDetail(null);
      } finally {
        if (!isCancelled()) setLoadingDetail(false);
      }
    },
    [projectPath, onCommitSelect, safeInvoke, isCancelled],
  );

  const handlePull = async () => {
    setPulling(true);
    setError(null);
    try {
      await safeInvoke("git_pull", { projectPath });
      if (!isCancelled()) refresh();
    } catch (e) {
      if (!isCancelled()) setError(String(e));
    } finally {
      if (!isCancelled()) setPulling(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    try {
      await safeInvoke("git_push", { projectPath, branch: selectedBranch || null });
      if (!isCancelled()) {
        refresh();
        await loadBranches();
      }
    } catch (e) {
      if (!isCancelled()) setError(String(e));
    } finally {
      if (!isCancelled()) setPushing(false);
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
      <div style={{
        display: "flex", flexDirection: "column",
        borderBottom: "1px solid var(--aegis-border)", flexShrink: 0,
      }}>
        <div style={{ height: 48, display: "flex", alignItems: "center", padding: "0 10px", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 650, color: "var(--aegis-text)", flex: 1 }}>
            {t("git.history")}
          </span>

          <button
            onClick={handlePull}
            disabled={pulling}
            title={t("git.pull")}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "3px 7px", background: "none",
              border: "1px solid var(--aegis-border)", borderRadius: 5,
              fontSize: 11.5, color: "var(--aegis-text-muted)",
              cursor: pulling ? "not-allowed" : "pointer",
              opacity: pulling ? 0.6 : 1,
            }}
          >
            {t("git.pull")} {String.fromCharCode(8595)}{remoteCounts.behind}
          </button>
          <button
            onClick={handlePush}
            disabled={pushing}
            title={t("git.push")}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "3px 7px",
              background: pushing ? "rgb(var(--aegis-accent))" : "none",
              border: `1px solid ${pushing ? "rgb(var(--aegis-accent))" : "var(--aegis-border)"}`,
              borderRadius: 5, fontSize: 11.5,
              color: pushing ? "var(--aegis-btn-primary-text)" : "var(--aegis-text-muted)",
              cursor: pushing ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {pushing ? (
              <>
                <Loader2 size={11} style={{ animation: "spin 1s linear infinite" }} />
                {t("git.pushing")}
              </>
            ) : (
              <>{t("git.push")} {String.fromCharCode(8593)}{remoteCounts.ahead}</>
            )}
          </button>
          <button
            onClick={() => refresh()}
            title={t("common.refresh")}
            style={{
              background: "none", border: "none", cursor: "pointer",
              padding: 4, borderRadius: 4, color: "var(--aegis-text-dim)",
              display: "flex", alignItems: "center",
            }}
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Branch selector */}
        <div ref={branchDropRef} style={{ padding: "0 10px 8px", position: "relative" }}>
          <button
            onClick={() => setBranchOpen((o) => !o)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              width: "100%", padding: "5px 8px",
              background: branchOpen ? "var(--aegis-hover)" : "transparent",
              border: "1px solid var(--aegis-border)", borderRadius: 6,
              cursor: "pointer", color: "var(--aegis-text)", fontSize: 12,
              transition: "background 0.1s",
            }}
          >
            <GitBranchIcon size={11} color="var(--aegis-text-dim)" style={{ flexShrink: 0 }} />
            <span style={{
              flex: 1, textAlign: "left", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500,
            }}>
              {selectedBranch || "…"}
            </span>
            <ChevronDown
              size={11}
              color="var(--aegis-text-dim)"
              style={{
                flexShrink: 0, transition: "transform 0.15s",
                transform: branchOpen ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>

          {branchOpen && (
            <div
              style={{
                position: "absolute", top: "calc(100% - 2px)", left: 10, right: 10,
                background: "var(--aegis-card)",
                border: "1px solid var(--aegis-border)", borderRadius: 7,
                boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
                zIndex: 200, overflow: "hidden",
              }}
            >
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 10px", borderBottom: "1px solid var(--aegis-border)",
              }}>
                <Search size={13} color="var(--aegis-text-dim)" />
                <input
                  autoFocus
                  placeholder={t("branch.searchBranches")}
                  value={branchSearch}
                  onChange={(e) => setBranchSearch(e.target.value)}
                  style={{
                    flex: 1, border: "none", outline: "none",
                    background: "transparent", color: "var(--aegis-text)",
                    fontSize: 12, fontFamily: "inherit",
                  }}
                />
                {branchSearch && (
                  <button
                    onClick={() => setBranchSearch("")}
                    title={t("common.reset")}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: 0, color: "var(--aegis-text-dim)",
                      display: "flex", alignItems: "center",
                    }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {filteredBranches.map((b) => {
                  const active = selectedBranch === b.name;
                  return (
                    <BranchOption
                      key={b.name}
                      name={b.name}
                      current={b.current}
                      active={active}
                      onClick={() => {
                        setSelectedBranch(b.name);
                        setBranchOpen(false);
                      }}
                    />
                  );
                })}
                {filteredBranches.length === 0 && (
                  <div style={{
                    padding: "16px 12px", fontSize: 12,
                    color: "var(--aegis-text-dim)", textAlign: "center",
                  }}>
                    {t("branch.noBranchesFound")}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 10px 4px", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 9px", background: "var(--aegis-card)",
          border: "1px solid var(--aegis-border)", borderRadius: 6,
        }}>
          <Search size={12} color="var(--aegis-text-dim)" />
          <input
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t("git.searchCommits")}
            style={{
              flex: 1, border: "none", outline: "none",
              background: "transparent", color: "var(--aegis-text)",
              fontSize: 12, fontFamily: "inherit",
            }}
          />
          <Filter size={12} color="var(--aegis-text-dim)" />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          margin: "0 10px 4px", padding: "6px 10px",
          background: "var(--aegis-danger-surface)",
          border: "1px solid rgb(var(--aegis-danger) / 0.25)",
          borderRadius: 6, fontSize: 11.5,
          color: "rgb(var(--aegis-danger))",
        }}>
          {error}
        </div>
      )}

      {/* Commit list */}
      <div style={{
        flex: selectedDetail ? "0 0 auto" : 1,
        overflowY: "auto",
        maxHeight: selectedDetail ? "50%" : undefined,
      }}>
        {loading && commits.length === 0 && (
          <div style={{ padding: "20px 16px", fontSize: 12, color: "var(--aegis-text-dim)", textAlign: "center" }}>
            {t("common.loadingEllipsis")}
          </div>
        )}
        {commits.map((commit) => {
          const isSelected = commit.hash === selectedHash;
          return (
            <CommitRow
              key={commit.hash}
              commit={commit}
              isSelected={isSelected}
              onClick={() => handleSelectCommit(commit)}
            />
          );
        })}
        {!loading && commits.length === 0 && (
          <div style={{ padding: "20px 16px", fontSize: 12, color: "var(--aegis-text-dim)", textAlign: "center" }}>
            {t("git.noCommitsFound")}
          </div>
        )}
      </div>

      {/* Commit detail */}
      {selectedDetail && (
        <div style={{
          borderTop: "1px solid var(--aegis-border)",
          overflow: "hidden", display: "flex", flexDirection: "column", flex: 1,
        }}>
          <CommitDetailPanel
            detail={selectedDetail}
            loading={loadingDetail}
            onFileClick={
              onFileClick
                ? (path) => onFileClick(selectedDetail.hash, path, `${path} @ ${selectedDetail.short_hash}`)
                : undefined
            }
          />
        </div>
      )}
    </div>
  );
}
