// ─────────────────────────────────────────────────────────────────
// PaneTreeView — kooky PaneTreeView 1:1 port.
//
// Recursively renders a PaneNode tree (leaf → ShellTerminalPanel,
// split → two children + draggable divider). Supports pane zoom
// (⌘⇧E — hide non-focused panes) and hover split buttons.
//
// Source: kooky Sources/KookyKit/Terminal/PaneTreeView.swift (1311 lines)
// ─────────────────────────────────────────────────────────────────

import { useRef, useState, useCallback, useEffect } from 'react';
import { Maximize2, SplitSquareHorizontal, SplitSquareVertical, X } from 'lucide-react';
import { ShellTerminalPanel } from './ShellTerminalPanel';
import { useI18n } from './i18n-fallback';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type {
  PaneNode,
  PaneSplit,
  SplitDirection,
  Workspace,
} from '@/workspace/types';
import type { ThemeVariant, TerminalFontSize, FontFamily } from '@/_nezha_root/types';

// ── Props ───────────────────────────────────────────────────────────────────

interface PaneTreeViewProps {
  workspace: Workspace;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  projectPath: string;
  onClose?: () => void;
  onToggleSidebar?: () => void;
  sidebarActive?: boolean;
}

// ── Recursive node renderer ─────────────────────────────────────────────────

function PaneNodeRenderer({
  node,
  workspace,
  focusedPaneId,
  zoomedPaneId,
  isZoomed,
  onFocus,
  onSplit,
  onClose,
  onZoom,
  themeVariant,
  terminalFontSize,
  monoFontFamily,
  projectPath,
  onToggleSidebar,
  sidebarActive,
  resizeSuspended,
}: {
  node: PaneNode;
  workspace: Workspace;
  focusedPaneId: string;
  zoomedPaneId: string | null;
  isZoomed: boolean;
  onFocus: (id: string) => void;
  onSplit: (leafId: string, direction: SplitDirection) => void;
  onClose: (leafId: string) => void;
  onZoom: (paneId: string) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  projectPath: string;
  onToggleSidebar?: () => void;
  sidebarActive?: boolean;
  resizeSuspended: boolean;
}) {
  if (node.type === 'leaf') {
    // In zoom mode, only the zoomed pane is visible
    const hidden = isZoomed && node.id !== zoomedPaneId;
    const isFocused = node.id === focusedPaneId;

    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: hidden ? 'none' : 'flex',
          flexDirection: 'column',
          position: 'relative',
          outline: isFocused ? '1px solid rgb(var(--aegis-primary)/0.3)' : 'none',
          outlineOffset: -1,
        }}
        onClick={() => !isFocused && onFocus(node.id)}
      >
        <ShellTerminalPanel
          ref={undefined}
          themeVariant={themeVariant}
          terminalFontSize={terminalFontSize}
          monoFontFamily={monoFontFamily}
          projectPath={node.config.cwd || workspace.workingDirectory || projectPath}
          projectId={node.id}
          paneFocused={isFocused}
          onPaneFocus={() => onFocus(node.id)}
          onDirectoryChange={(cwd) => useWorkspaceStore.getState().setPaneCwd(node.id, cwd)}
          onClose={() => onClose(node.id)}
          onSplitHorizontal={() => onSplit(node.id, 'horizontal')}
          onSplitVertical={() => onSplit(node.id, 'vertical')}
          canZoom={true}
          isZoomed={zoomedPaneId === node.id}
          onZoom={() => onZoom(node.id)}
          onToggleSidebar={onToggleSidebar}
          sidebarActive={sidebarActive}
          resizeSuspended={resizeSuspended}
        />
      </div>
    );
  }

  // Split node — render two children with draggable divider
  return (
    <SplitRenderer
      node={node}
      workspace={workspace}
      focusedPaneId={focusedPaneId}
      zoomedPaneId={zoomedPaneId}
      isZoomed={isZoomed}
      onFocus={onFocus}
      onSplit={onSplit}
      onClose={onClose}
      onZoom={onZoom}
      themeVariant={themeVariant}
      terminalFontSize={terminalFontSize}
      monoFontFamily={monoFontFamily}
      projectPath={projectPath}
      onToggleSidebar={onToggleSidebar}
      sidebarActive={sidebarActive}
      resizeSuspended={resizeSuspended}
    />
  );
}

// ── Split renderer with draggable divider ───────────────────────────────────

function SplitRenderer({
  node,
  workspace,
  focusedPaneId,
  zoomedPaneId,
  isZoomed,
  onFocus,
  onSplit,
  onClose,
  onZoom,
  themeVariant,
  terminalFontSize,
  monoFontFamily,
  projectPath,
  onToggleSidebar,
  sidebarActive,
  resizeSuspended,
}: {
  node: PaneSplit;
  workspace: Workspace;
  focusedPaneId: string;
  zoomedPaneId: string | null;
  isZoomed: boolean;
  onFocus: (id: string) => void;
  onSplit: (leafId: string, direction: SplitDirection) => void;
  onClose: (leafId: string) => void;
  onZoom: (paneId: string) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  monoFontFamily: FontFamily;
  projectPath: string;
  onToggleSidebar?: () => void;
  sidebarActive?: boolean;
  resizeSuspended: boolean;
}) {
  const { t } = useI18n();
  const isHorizontal = node.direction === 'horizontal';
  const [ratio, setRatio] = useState(node.sizes[0]);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  // Sync ratio from store when node.sizes changes externally
  useEffect(() => {
    setRatio(node.sizes[0]);
    ratioRef.current = node.sizes[0];
  }, [node.sizes[0]]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      let newRatio: number;
      if (isHorizontal) {
        newRatio = (e.clientX - rect.left) / rect.width;
      } else {
        newRatio = (e.clientY - rect.top) / rect.height;
      }
      newRatio = Math.max(0.15, Math.min(0.85, newRatio));
      ratioRef.current = newRatio;
      setRatio(newRatio);
    };
    const onUp = () => {
      setDragging(false);
      // Persist to store on mouse up
      useWorkspaceStore.getState().resizeSplit(node.id, ratioRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, isHorizontal, node.id]);

  const splitterSize = 4;
  const descendantsResizeSuspended = resizeSuspended || dragging;
  const childStyleA = { flex: ratio, minWidth: 0, minHeight: 0, display: 'flex' as const, overflow: 'hidden' as const };
  const childStyleB = { flex: 1 - ratio, minWidth: 0, minHeight: 0, display: 'flex' as const, overflow: 'hidden' as const };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Child A */}
      <div style={childStyleA}>
        <PaneNodeRenderer
          node={node.children[0]}
          workspace={workspace}
          focusedPaneId={focusedPaneId}
          zoomedPaneId={zoomedPaneId}
          isZoomed={isZoomed}
          onFocus={onFocus}
          onSplit={onSplit}
          onClose={onClose}
          onZoom={onZoom}
          themeVariant={themeVariant}
          terminalFontSize={terminalFontSize}
          monoFontFamily={monoFontFamily}
          projectPath={projectPath}
          onToggleSidebar={onToggleSidebar}
          sidebarActive={sidebarActive}
          resizeSuspended={descendantsResizeSuspended}
        />
      </div>

      {/* Splitter bar */}
      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          width: isHorizontal ? splitterSize : '100%',
          height: isHorizontal ? '100%' : splitterSize,
          flexShrink: 0,
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          background: dragging
            ? 'rgb(var(--aegis-primary))'
            : hovering
              ? 'rgb(var(--aegis-primary)/0.3)'
              : 'transparent',
          transition: dragging ? 'none' : 'background 0.15s',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        {/* Hover split buttons (kooky SplitButtonOverlay) */}
        {(hovering || dragging) && (
          <div
            style={{
              display: 'flex',
              gap: 2,
              background: 'rgb(var(--aegis-elevated))',
              borderRadius: 6,
              border: '1px solid rgb(255 255 255 / 0.06)',
              padding: 2,
              boxShadow: '0 4px 12px rgb(0 0 0 / 0.3)',
            }}
          >
            <SplitButton
              label={t('terminal.splitRight', 'Split Right')}
              onClick={(e) => {
                e.stopPropagation();
                // Find a leaf in child A or B to split
                const leafIds = listAllLeafIds(node);
                const target = leafIds.includes(focusedPaneId) ? focusedPaneId : leafIds[0];
                if (target) onSplit(target, 'horizontal');
              }}
            >
              <SplitSquareHorizontal size={12} />
            </SplitButton>
            <SplitButton
              label={t('terminal.splitDown', 'Split Down')}
              onClick={(e) => {
                e.stopPropagation();
                const leafIds = listAllLeafIds(node);
                const target = leafIds.includes(focusedPaneId) ? focusedPaneId : leafIds[0];
                if (target) onSplit(target, 'vertical');
              }}
            >
              <SplitSquareVertical size={12} />
            </SplitButton>
          </div>
        )}
      </div>

      {/* Child B */}
      <div style={childStyleB}>
        <PaneNodeRenderer
          node={node.children[1]}
          workspace={workspace}
          focusedPaneId={focusedPaneId}
          zoomedPaneId={zoomedPaneId}
          isZoomed={isZoomed}
          onFocus={onFocus}
          onSplit={onSplit}
          onClose={onClose}
          onZoom={onZoom}
          themeVariant={themeVariant}
          terminalFontSize={terminalFontSize}
          monoFontFamily={monoFontFamily}
          projectPath={projectPath}
          onToggleSidebar={onToggleSidebar}
          sidebarActive={sidebarActive}
          resizeSuspended={descendantsResizeSuspended}
        />
      </div>
    </div>
  );
}

function SplitButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        border: 'none',
        borderRadius: 5,
        color: 'rgb(var(--aegis-text-dim))',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'rgb(var(--aegis-overlay)/0.08)';
        (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = 'transparent';
        (e.currentTarget as HTMLElement).style.color = 'rgb(var(--aegis-text-dim))';
      }}
    >
      {children}
    </button>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function listAllLeafIds(node: PaneNode): string[] {
  if (node.type === 'leaf') return [node.id];
  return [...listAllLeafIds(node.children[0]), ...listAllLeafIds(node.children[1])];
}

// ── Main component ──────────────────────────────────────────────────────────

export function PaneTreeView({
  workspace,
  themeVariant,
  terminalFontSize,
  monoFontFamily,
  projectPath,
  onClose,
  onToggleSidebar,
  sidebarActive,
}: PaneTreeViewProps) {
  const { t } = useI18n();
  const [zoomedPaneId, setZoomedPaneId] = useState<string | null>(null);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const closePane = useWorkspaceStore((s) => s.closePane);

  const isZoomed = zoomedPaneId !== null;

  // ⌘⇧E toggles pane zoom; Escape must always return to the full tree.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zoomedPaneId) {
        e.preventDefault();
        setZoomedPaneId(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        setZoomedPaneId((prev) => {
          if (prev) return null; // un-zoom
          return workspace.focusedPaneId; // zoom to focused pane
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [workspace.focusedPaneId, zoomedPaneId]);

  const handleSplit = useCallback(
    (leafId: string, direction: SplitDirection) => {
      splitPane(leafId, direction);
    },
    [splitPane],
  );

  const handleClose = useCallback(
    (leafId: string) => {
      closePane(leafId);
      const leafIds = listAllLeafIds(workspace.root);
      if (leafIds.length <= 1 && onClose) onClose();
    },
    [closePane, workspace.root, onClose],
  );

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
      }}
    >
      {/* Zoom badge */}
      {isZoomed && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 50,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            background: 'rgb(var(--aegis-elevated))',
            border: '1px solid rgb(255 255 255 / 0.08)',
            color: 'rgb(var(--aegis-text-dim))',
            fontSize: 11,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <Maximize2 size={13} aria-label={t('terminal.zoom', 'Pane zoom')} />
          <button
            onClick={() => setZoomedPaneId(null)}
            title={t('terminal.exitZoom', 'Exit pane zoom')}
            aria-label={t('terminal.exitZoom', 'Exit pane zoom')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'rgb(var(--aegis-text-dim))',
              padding: 0,
              display: 'flex',
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Recursive tree */}
      <PaneNodeRenderer
        node={workspace.root}
        workspace={workspace}
        focusedPaneId={workspace.focusedPaneId}
        zoomedPaneId={zoomedPaneId}
        isZoomed={isZoomed}
        onFocus={(id) => {
          setFocus(id);
          if (zoomedPaneId === id) setZoomedPaneId(null);
        }}
        onSplit={handleSplit}
        onClose={handleClose}
        onZoom={(id) => setZoomedPaneId((prev) => prev === id ? null : id)}
        themeVariant={themeVariant}
        terminalFontSize={terminalFontSize}
        monoFontFamily={monoFontFamily}
        projectPath={projectPath}
        onToggleSidebar={onToggleSidebar}
        sidebarActive={sidebarActive}
        resizeSuspended={false}
      />
    </div>
  );
}

export default PaneTreeView;
