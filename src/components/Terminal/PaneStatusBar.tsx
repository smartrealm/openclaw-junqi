// kooky PaneStatusBar 1:1 port — 底部状态栏 (28px)
// 横向排列多个插槽 pill，每个 pill 是一个独立子组件。
// - GitBranchSlot: 显示当前分支，点击弹出分支列表并支持切换
// - GitDiffSlot: 显示未暂存变更统计 (files changed / +insertions / -deletions)
// - ComposerToggleSlot: 铅笔图标，触发 ComposerBar 显隐

import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ──────────────────────────────────────────────
// 通用 pill 样式
// ──────────────────────────────────────────────

const pillBase: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "0 8px",
  height: 22,
  borderRadius: 4,
  fontSize: 11,
  fontFamily: '"JetBrains Mono", monospace',
  color: "rgb(var(--aegis-text-dim))",
  background: "transparent",
  border: "none",
  cursor: "pointer",
};

// ──────────────────────────────────────────────
// GitBranchSlot
// ──────────────────────────────────────────────

function GitBranchSlot({ projectPath }: { projectPath: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // 初始获取分支名
  useEffect(() => {
    let cancelled = false;
    invoke<string>("git_branch", { projectPath })
      .then((b) => { if (!cancelled) setBranch(b); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectPath]);

  // 点击时获取分支列表
  const handleTogglePopover = useCallback(() => {
    if (popoverOpen) { setPopoverOpen(false); return; }
    invoke<string[]>("git_branches", { projectPath })
      .then((list) => {
        setBranches(list);
        setPopoverOpen(true);
      })
      .catch(() => {});
  }, [popoverOpen, projectPath]);

  // 点击外部关闭
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [popoverOpen]);

  const handleCheckout = useCallback((b: string) => {
    invoke("git_checkout", { projectPath, branch: b }).catch(() => {});
    setBranch(b);
    setPopoverOpen(false);
  }, [projectPath]);

  if (!branch) return null;

  return (
    <div style={{ position: "relative" }}>
      <button
        ref={anchorRef}
        onClick={handleTogglePopover}
        style={pillBase}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(var(--aegis-overlay)/0.06)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
      >
        <span style={{ opacity: 0.6 }}>⎇</span> {branch}
      </button>
      {popoverOpen && (
        <div
          style={{
            position: "absolute",
            bottom: 28,
            left: 0,
            zIndex: 100,
            minWidth: 160,
            maxHeight: 240,
            overflowY: "auto",
            background: "rgb(var(--aegis-elevated))",
            border: "1px solid rgb(255 255 255 / 0.08)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgb(0 0 0 / 0.4)",
            padding: "4px 0",
          }}
        >
          {branches.map((b) => (
            <div
              key={b}
              onClick={() => handleCheckout(b)}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                fontFamily: '"JetBrains Mono", monospace',
                color: b === branch ? "rgb(var(--aegis-primary))" : "rgb(var(--aegis-text))",
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: b === branch ? "rgb(var(--aegis-overlay)/0.08)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (b !== branch) (e.currentTarget as HTMLElement).style.background = "rgb(var(--aegis-overlay)/0.06)";
              }}
              onMouseLeave={(e) => {
                if (b !== branch) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              {b}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// GitDiffSlot
// ──────────────────────────────────────────────

interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

function GitDiffSlot({ projectPath }: { projectPath: string }) {
  const [stat, setStat] = useState<GitDiffStat | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<GitDiffStat>("git_diff_stat", { projectPath })
      .then((s) => { if (!cancelled) setStat(s); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [projectPath]);

  if (!stat || (stat.filesChanged === 0 && stat.insertions === 0 && stat.deletions === 0)) return null;

  return (
    <span
      style={{ ...pillBase, cursor: "default" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(var(--aegis-overlay)/0.06)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {stat.filesChanged} files{" "}
      <span style={{ color: "rgb(34 197 94)" }}>+{stat.insertions}</span>{" "}
      <span style={{ color: "rgb(239 68 68)" }}>−{stat.deletions}</span>
    </span>
  );
}

// ──────────────────────────────────────────────
// ComposerToggleSlot
// ──────────────────────────────────────────────

function ComposerToggleSlot({ paneId }: { paneId: string }) {
  const handleClick = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("junqi:toggle-composer", { detail: { paneId } }),
    );
  }, [paneId]);

  return (
    <button
      onClick={handleClick}
      title="内嵌 Prompt (⌘L)"
      style={pillBase}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(var(--aegis-overlay)/0.06)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
    >
      {/* 铅笔图标 */}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  );
}

// ──────────────────────────────────────────────
// PaneStatusBar
// ──────────────────────────────────────────────

export interface PaneStatusBarProps {
  projectPath: string;
  paneId: string;
  onToggleComposer?: () => void;
  /** kooky PaneStatusBar zoom button — shown when multiple panes exist */
  canZoom?: boolean;
  isZoomed?: boolean;
  onZoom?: () => void;
}

export function PaneStatusBar({ projectPath, paneId, onToggleComposer, canZoom, isZoomed, onZoom }: PaneStatusBarProps) {
  // 监听外部 toggle 事件（如 ⌘L）
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ paneId: string }>;
      if (ce.detail?.paneId === paneId) {
        onToggleComposer?.();
      }
    };
    window.addEventListener("junqi:toggle-composer", handler);
    return () => window.removeEventListener("junqi:toggle-composer", handler);
  }, [paneId, onToggleComposer]);

  return (
    <div
      style={{
        height: 28,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 8px",
        borderTop: "1px solid rgb(255 255 255 / 0.07)",
        background: "rgb(var(--aegis-surface))",
        overflow: "hidden",
      }}
    >
      <GitBranchSlot projectPath={projectPath} />
      <GitDiffSlot projectPath={projectPath} />
      {/* 弹性空间 — 将右侧按鈕推到右侧 */}
      <div style={{ flex: 1 }} />
      {/* kooky StatusBarIconButton zoom — only when canZoom */}
      {canZoom && (
        <button
          onClick={onZoom}
          title={isZoomed ? 'Exit Zoom (Esc)' : 'Zoom Pane (Cmd+Shift+E)'}
          style={{ ...pillBase, color: isZoomed ? 'rgb(var(--aegis-primary))' : 'rgb(var(--aegis-text-dim))' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.06)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
            {isZoomed
              ? <><path d='M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3'/></>
              : <><path d='M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'/></>
            }
          </svg>
        </button>
      )}
      <ComposerToggleSlot paneId={paneId} />
    </div>
  );
}
