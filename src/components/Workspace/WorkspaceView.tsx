// ─────────────────────────────────────────────────────────────────
// WorkspaceView — recursive multi-pane renderer.
//
// Wraps a single workspace's root PaneNode and renders leaves (shell /
// agent panes) interleaved with draggable splitters. Tree updates
// flow through workspaceStore; this component is pure read.
// ─────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react';
import clsx from 'clsx';
import { Plus, X, Terminal as TerminalIcon, Sparkles } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { PaneLeaf, PaneNode, PaneSplit } from '@/workspace/types';
import { ShellTerminalPanel } from '@/components/Terminal/ShellTerminalPanel';
import { AgentRunView } from '@/pages/AgentRunView';
import { useTheme } from '@/theme';
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  getDefaultMonoFont,
  type ThemeVariant,
  type TerminalFontSize,
  type FontFamily,
} from '@/_nezha_root/types';

export function WorkspaceView() {
  const workspace = useWorkspaceStore((s) => {
    const id = s.activeWorkspaceId;
    return id ? s.workspaces.find((w) => w.id === id) ?? null : null;
  });

  // Bootstrap: ensure there's always an active workspace.
  const ensureActive = useWorkspaceStore((s) => s.ensureActive);
  useEffect(() => { ensureActive(); }, [ensureActive]);

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full text-aegis-text-dim">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden">
      <PaneNodeView node={workspace.root} workspaceId={workspace.id} />
    </div>
  );
}

interface PaneNodeViewProps {
  node: PaneNode;
  workspaceId: string;
}

/**
 * Recursive renderer. Splits lay out children via flex; leaves render
 * the appropriate content (shell / agent).
 */
function PaneNodeView({ node, workspaceId }: PaneNodeViewProps) {
  if (node.type === 'leaf') {
    return <LeafPaneView leaf={node} />;
  }
  return <SplitPaneView split={node} workspaceId={workspaceId} />;
}

function SplitPaneView({ split, workspaceId }: { split: PaneSplit; workspaceId: string }) {
  const resizeSplit = useWorkspaceStore((s) => s.resizeSplit);
  const [a, b] = split.children;
  const isHorizontal = split.direction === 'horizontal';

  // Track container size so the divider drag can convert pixels → fraction.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerPx, setContainerPx] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      const px = isHorizontal ? e.contentRect.width : e.contentRect.height;
      setContainerPx(px);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [isHorizontal]);

  const [aSize, bSize] = split.sizes;

  const onSplitterDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const totalPx = isHorizontal ? rect.width : rect.height;
    const startRatio = split.sizes[0];
    const startOffset = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;

    const onMove = (ev: PointerEvent) => {
      const currentOffset = isHorizontal ? ev.clientX - rect.left : ev.clientY - rect.top;
      const delta = (currentOffset - startOffset) / totalPx;
      resizeSplit(split.id, startRatio + delta);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [isHorizontal, resizeSplit, split.id, split.sizes]);

  const flexDir = isHorizontal ? 'flex-row' : 'flex-col';

  return (
    <div ref={containerRef} className={clsx('flex h-full w-full', flexDir)} data-workspace={workspaceId} data-split={split.id}>
      <div
        style={{
          flexBasis: 0,
          flexGrow: aSize,
          flexShrink: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <PaneNodeView node={a} workspaceId={workspaceId} />
      </div>

      {/* Drag handle */}
      <div
        onPointerDown={onSplitterDown}
        className={clsx(
          'shrink-0 select-none transition-colors',
          isHorizontal
            ? 'w-1 h-full cursor-col-resize hover:bg-aegis-primary/40'
            : 'h-1 w-full cursor-row-resize hover:bg-aegis-primary/40',
        )}
        style={{ background: 'transparent' }}
        title="Drag to resize"
        data-splitter={split.id}
      />

      <div
        style={{
          flexBasis: 0,
          flexGrow: bSize,
          flexShrink: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <PaneNodeView node={b} workspaceId={workspaceId} />
      </div>
    </div>
  );
}

/**
 * ShellPaneHost — supplies the global terminal settings (theme, font size,
 * mono font) so each shell pane in the workspace renders consistently.
 */
function ShellPaneHost({ leaf }: { leaf: PaneLeaf }) {
  const closePane = useWorkspaceStore((s) => s.closePane);
  const resolvedTheme = useTheme();
  const themeVariant: ThemeVariant = resolvedTheme.replace('aegis-', '') as ThemeVariant;
  return (
    <ShellTerminalPanel
      themeVariant={themeVariant}
      terminalFontSize={DEFAULT_TERMINAL_FONT_SIZE as TerminalFontSize}
      monoFontFamily={getDefaultMonoFont() as FontFamily}
      projectPath={leaf.config.projectPath ?? ''}
      projectId={leaf.id}
      onClose={() => closePane(leaf.id)}
    />
  );
}

function LeafPaneView({ leaf }: { leaf: PaneLeaf }) {
  const setFocus = useWorkspaceStore((s) => s.setFocus);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const isFocused = useWorkspaceStore((s) => {
    const w = s.workspaces.find((x) => x.id === s.activeWorkspaceId);
    return w?.focusedPaneId === leaf.id;
  });

  return (
    <div
      onMouseDown={() => setFocus(leaf.id)}
      className={clsx(
        'relative h-full w-full overflow-hidden',
        isFocused ? 'ring-1 ring-inset ring-aegis-primary/40' : 'ring-0',
      )}
    >
      {/* Tab strip (kooky-style) */}
      <div className="flex items-center h-7 px-1.5 gap-1 border-b border-aegis-border bg-aegis-bg/60 backdrop-blur-sm text-[11px] select-none">
        {leaf.config.kind === 'shell' ? (
          <TerminalIcon size={11} className="text-aegis-text-muted shrink-0" />
        ) : (
          <Sparkles size={11} className="text-aegis-primary shrink-0" />
        )}
        <span className="font-medium text-aegis-text-secondary truncate">
          {leaf.config.label ?? (leaf.config.kind === 'shell' ? 'Shell' : (leaf.config.agent ?? 'Agent'))}
        </span>
        {leaf.config.kind === 'agent' && leaf.config.agent && (
          <span className="text-aegis-text-dim">· {leaf.config.agent}</span>
        )}
        {leaf.config.projectPath && (
          <span className="text-aegis-text-dim truncate" title={leaf.config.projectPath}>
            · {leaf.config.projectPath.split('/').pop() || leaf.config.projectPath}
          </span>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            title="Split horizontally"
            onClick={(e) => { e.stopPropagation(); splitPane(leaf.id, 'horizontal'); }}
            className="p-1 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-overlay/5"
          >
            <Plus size={11} className="rotate-90" />
          </button>
          <button
            type="button"
            title="Split vertically"
            onClick={(e) => { e.stopPropagation(); splitPane(leaf.id, 'vertical'); }}
            className="p-1 rounded text-aegis-text-dim hover:text-aegis-text hover:bg-aegis-overlay/5"
          >
            <Plus size={11} />
          </button>
          <button
            type="button"
            title="Close pane"
            onClick={(e) => { e.stopPropagation(); closePane(leaf.id); }}
            className="p-1 rounded text-aegis-text-dim hover:text-aegis-danger hover:bg-aegis-overlay/5"
          >
            <X size={11} />
          </button>
        </span>
      </div>

      {/* Pane content */}
      <div className="h-[calc(100%-1.75rem)] w-full">
        {leaf.config.kind === 'shell' ? (
          <ShellPaneHost leaf={leaf} />
        ) : (
          <AgentRunView />
        )}
      </div>
    </div>
  );
}