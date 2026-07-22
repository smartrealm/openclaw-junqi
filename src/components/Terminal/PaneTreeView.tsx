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
import { paneNodeContains, resolvePaneSplitLayout } from './paneTreeLayout';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type {
  PaneNode,
  PaneSplit,
  SplitDirection,
  Workspace,
} from '@/workspace/types';
import type { ThemeVariant, TerminalFontSize, FontFamily } from '@/junqi/types';

// ── Props ───────────────────────────────────────────────────────────────────

interface PaneTreeViewProps {
  workspace: Workspace;
  isActive?: boolean;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: number;
  terminalShiftEnterNewline: boolean;
  monoFontFamily: FontFamily;
  projectPath: string;
  onClose?: () => void;
  resizeSuspended?: boolean;
}

// ── Recursive node renderer ─────────────────────────────────────────────────

function PaneNodeRenderer({
  node,
  workspace,
  focusedPaneId,
  zoomedPaneId,
  isZoomed,
  canZoom,
  onFocus,
  onSplit,
  onClose,
  onZoom,
  themeVariant,
  terminalFontSize,
  terminalScrollback,
  terminalShiftEnterNewline,
  monoFontFamily,
  projectPath,
  workspaceActive,
  resizeSuspended,
}: {
  node: PaneNode;
  workspace: Workspace;
  focusedPaneId: string;
  zoomedPaneId: string | null;
  isZoomed: boolean;
  canZoom: boolean;
  onFocus: (id: string) => void;
  onSplit: (leafId: string, direction: SplitDirection) => void;
  onClose: (leafId: string) => void;
  onZoom: (paneId: string) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: number;
  terminalShiftEnterNewline: boolean;
  monoFontFamily: FontFamily;
  projectPath: string;
  workspaceActive: boolean;
  resizeSuspended: boolean;
}) {
  if (node.type === 'leaf') {
    const isFocused = node.id === focusedPaneId;

    return (
      <div
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          // Ancestor split containers own zoom visibility. Keeping every leaf
          // mounted is essential: xterm retains its canvas, scrollback, and
          // PTY identity while its sibling is collapsed to zero size.
          display: 'flex',
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
          terminalScrollback={terminalScrollback}
          terminalShiftEnterNewline={terminalShiftEnterNewline}
          monoFontFamily={monoFontFamily}
          projectPath={workspace.sshRemoteHost ? '' : node.config.cwd || workspace.workingDirectory || projectPath}
          sshHost={workspace.sshRemoteHost}
          projectId={node.id}
          workspaceId={workspace.id}
          isActive={workspaceActive}
          paneFocused={workspaceActive && isFocused}
          onWorkspaceFocus={() => useWorkspaceStore.getState().setActive(workspace.id)}
          onPaneFocus={() => onFocus(node.id)}
          onDirectoryChange={(cwd) => {
            if (!workspace.sshRemoteHost) useWorkspaceStore.getState().setPaneCwd(node.id, cwd, workspace.id);
          }}
          onClose={() => onClose(node.id)}
          onSplitHorizontal={() => onSplit(node.id, 'horizontal')}
          onSplitVertical={() => onSplit(node.id, 'vertical')}
          canZoom={canZoom}
          isZoomed={zoomedPaneId === node.id}
          onZoom={() => onZoom(node.id)}
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
      canZoom={canZoom}
      onFocus={onFocus}
      onSplit={onSplit}
      onClose={onClose}
      onZoom={onZoom}
      themeVariant={themeVariant}
      terminalFontSize={terminalFontSize}
      terminalScrollback={terminalScrollback}
      terminalShiftEnterNewline={terminalShiftEnterNewline}
      monoFontFamily={monoFontFamily}
      projectPath={projectPath}
      workspaceActive={workspaceActive}
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
  canZoom,
  onFocus,
  onSplit,
  onClose,
  onZoom,
  themeVariant,
  terminalFontSize,
  terminalScrollback,
  terminalShiftEnterNewline,
  monoFontFamily,
  projectPath,
  workspaceActive,
  resizeSuspended,
}: {
  node: PaneSplit;
  workspace: Workspace;
  focusedPaneId: string;
  zoomedPaneId: string | null;
  isZoomed: boolean;
  canZoom: boolean;
  onFocus: (id: string) => void;
  onSplit: (leafId: string, direction: SplitDirection) => void;
  onClose: (leafId: string) => void;
  onZoom: (paneId: string) => void;
  themeVariant: ThemeVariant;
  terminalFontSize: TerminalFontSize;
  terminalScrollback: number;
  terminalShiftEnterNewline: boolean;
  monoFontFamily: FontFamily;
  projectPath: string;
  workspaceActive: boolean;
  resizeSuspended: boolean;
}) {
  const { t } = useI18n();
  const isHorizontal = node.direction === 'horizontal';
  const [ratio, setRatio] = useState(node.sizes[0]);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [containerExtent, setContainerExtent] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef(ratio);

  // Sync ratio from store when node.sizes changes externally
  useEffect(() => {
    setRatio(node.sizes[0]);
    ratioRef.current = node.sizes[0];
  }, [node.sizes[0]]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateExtent = () => {
      const rect = container.getBoundingClientRect();
      setContainerExtent((previous) => (
        previous.width === rect.width && previous.height === rect.height
          ? previous
          : { width: rect.width, height: rect.height }
      ));
    };
    updateExtent();
    const observer = new ResizeObserver(updateExtent);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

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
      newRatio = Math.max(0.1, Math.min(0.9, newRatio));
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

  // Kooky keeps the chrome hairline at 1px while a transparent 6px handle
  // overlaps it. Negative margins make the hit target free in layout terms.
  const splitterSize = 1;
  const splitterHitSize = 6;
  const descendantsResizeSuspended = resizeSuspended || dragging;
  const splitLayout = resolvePaneSplitLayout(node, zoomedPaneId, ratio);
  const firstContainsZoom = zoomedPaneId ? paneNodeContains(node.children[0], zoomedPaneId) : false;
  const secondContainsZoom = zoomedPaneId ? paneNodeContains(node.children[1], zoomedPaneId) : false;
  // Kooky offsets the collapsed sibling by the actual parent geometry, not
  // its own shrinking dimensions. Percentage transforms would become zero as
  // flex shrinks, leaving a momentary flash at the split edge.
  const pushDistance = Math.round(isHorizontal ? containerExtent.width : containerExtent.height);
  const childStyleA = {
    flex: splitLayout.firstFlex,
    minWidth: 0,
    minHeight: 0,
    display: splitLayout.firstVisible ? 'flex' as const : 'none' as const,
    overflow: 'hidden' as const,
    transform: secondContainsZoom
      ? (isHorizontal ? `translateX(-${pushDistance}px)` : `translateY(-${pushDistance}px)`)
      : 'translate(0, 0)',
    transition: dragging ? 'none' : 'flex 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    pointerEvents: firstContainsZoom || !zoomedPaneId ? 'auto' as const : 'none' as const,
  };
  const childStyleB = {
    flex: splitLayout.secondFlex,
    minWidth: 0,
    minHeight: 0,
    display: splitLayout.secondVisible ? 'flex' as const : 'none' as const,
    overflow: 'hidden' as const,
    transform: firstContainsZoom
      ? (isHorizontal ? `translateX(${pushDistance}px)` : `translateY(${pushDistance}px)`)
      : 'translate(0, 0)',
    transition: dragging ? 'none' : 'flex 220ms cubic-bezier(0.22, 1, 0.36, 1), transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
    pointerEvents: secondContainsZoom || !zoomedPaneId ? 'auto' as const : 'none' as const,
  };

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
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
          canZoom={canZoom}
          onFocus={onFocus}
          onSplit={onSplit}
          onClose={onClose}
          onZoom={onZoom}
          themeVariant={themeVariant}
          terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback}
          terminalShiftEnterNewline={terminalShiftEnterNewline}
          monoFontFamily={monoFontFamily}
          projectPath={projectPath}
          workspaceActive={workspaceActive}
          resizeSuspended={descendantsResizeSuspended}
        />
      </div>

      {/* Splitter bar */}
      <div
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          width: isHorizontal ? (splitLayout.splitterVisible ? splitterHitSize : 0) : '100%',
          height: isHorizontal ? '100%' : (splitLayout.splitterVisible ? splitterHitSize : 0),
          margin: isHorizontal ? `0 -${(splitterHitSize - splitterSize) / 2}px` : `-${(splitterHitSize - splitterSize) / 2}px 0`,
          flexShrink: 0,
          cursor: isHorizontal ? 'col-resize' : 'row-resize',
          background: 'transparent',
          transition: dragging ? 'none' : 'width 220ms cubic-bezier(0.22, 1, 0.36, 1), height 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease',
          position: 'relative',
          display: 'flex',
          opacity: splitLayout.splitterVisible ? 1 : 0,
          pointerEvents: splitLayout.splitterVisible ? 'auto' : 'none',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        <div style={{
          position: 'absolute',
          inset: isHorizontal ? '0 auto 0 50%' : '50% 0 auto 0',
          width: isHorizontal ? splitterSize : '100%',
          height: isHorizontal ? '100%' : splitterSize,
          transform: isHorizontal ? 'translateX(-50%)' : 'translateY(-50%)',
          background: dragging
            ? 'rgb(var(--aegis-primary))'
            : hovering ? 'rgb(var(--aegis-primary)/0.3)' : 'rgb(var(--aegis-overlay)/0.08)',
          pointerEvents: 'none',
          transition: 'background 0.15s',
        }} />
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
          canZoom={canZoom}
          onFocus={onFocus}
          onSplit={onSplit}
          onClose={onClose}
          onZoom={onZoom}
          themeVariant={themeVariant}
          terminalFontSize={terminalFontSize}
          terminalScrollback={terminalScrollback}
          terminalShiftEnterNewline={terminalShiftEnterNewline}
          monoFontFamily={monoFontFamily}
          projectPath={projectPath}
          workspaceActive={workspaceActive}
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
  isActive = true,
  themeVariant,
  terminalFontSize,
  terminalScrollback,
  terminalShiftEnterNewline,
  monoFontFamily,
  projectPath,
  onClose,
  resizeSuspended = false,
}: PaneTreeViewProps) {
  const { t } = useI18n();
  const zoomedPaneId = workspace.zoomedPaneId ?? null;
  const [zoomAnimating, setZoomAnimating] = useState(false);
  const zoomAnimationTimer = useRef<number | null>(null);
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const toggleZoom = useWorkspaceStore((s) => s.toggleZoom);

  const hasMultiplePanes = listAllLeafIds(workspace.root).length > 1;
  const isZoomed = zoomedPaneId !== null && paneNodeContains(workspace.root, zoomedPaneId);

  const beginZoomAnimation = useCallback(() => {
    if (zoomAnimationTimer.current !== null) window.clearTimeout(zoomAnimationTimer.current);
    setZoomAnimating(true);
    zoomAnimationTimer.current = window.setTimeout(() => {
      zoomAnimationTimer.current = null;
      setZoomAnimating(false);
    }, 250);
  }, []);
  useEffect(() => () => {
    if (zoomAnimationTimer.current !== null) window.clearTimeout(zoomAnimationTimer.current);
  }, []);

  // ⌘⇧E toggles pane zoom; Escape must always return to the full tree.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isActive) return;
      if (e.key === 'Escape' && zoomedPaneId) {
        e.preventDefault();
        beginZoomAnimation();
        toggleZoom(zoomedPaneId, workspace.id);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        if (!hasMultiplePanes && !zoomedPaneId) return;
        beginZoomAnimation();
        toggleZoom(zoomedPaneId ?? workspace.focusedPaneId, workspace.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [beginZoomAnimation, hasMultiplePanes, isActive, toggleZoom, workspace.focusedPaneId, workspace.id, zoomedPaneId]);

  const handleSplit = useCallback(
    (leafId: string, direction: SplitDirection) => {
      if (zoomedPaneId) beginZoomAnimation();
      splitPane(leafId, direction, undefined, workspace.id);
    },
    [beginZoomAnimation, splitPane, workspace.id, zoomedPaneId],
  );

  const handleClose = useCallback(
    (leafId: string) => {
      if (zoomedPaneId === leafId) beginZoomAnimation();
      closePane(leafId, workspace.id);
      const leafIds = listAllLeafIds(workspace.root);
      if (leafIds.length <= 1 && onClose) onClose();
    },
    [beginZoomAnimation, closePane, onClose, workspace.id, workspace.root, zoomedPaneId],
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
            onClick={() => {
              beginZoomAnimation();
              toggleZoom(zoomedPaneId, workspace.id);
            }}
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
        canZoom={hasMultiplePanes || isZoomed}
        onFocus={(id) => {
          setFocus(id, workspace.id);
          if (zoomedPaneId && zoomedPaneId !== id) beginZoomAnimation();
        }}
        onSplit={handleSplit}
        onClose={handleClose}
        onZoom={(id) => {
          if (!hasMultiplePanes && zoomedPaneId !== id) return;
          beginZoomAnimation();
          toggleZoom(id, workspace.id);
        }}
        themeVariant={themeVariant}
        terminalFontSize={terminalFontSize}
        terminalScrollback={terminalScrollback}
        terminalShiftEnterNewline={terminalShiftEnterNewline}
        monoFontFamily={monoFontFamily}
        projectPath={projectPath}
        workspaceActive={isActive}
        resizeSuspended={resizeSuspended || zoomAnimating}
      />
    </div>
  );
}

export default PaneTreeView;
