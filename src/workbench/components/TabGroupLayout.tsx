import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { clampSplitRatio } from '../domain/tabGroupLayout';
import type { TabGroupId, TabGroupLayoutNode } from '../domain/types';

export function TabGroupLayout({ node, renderGroup, onResize }: {
  node: TabGroupLayoutNode;
  renderGroup: (groupId: TabGroupId) => ReactNode;
  onResize: (splitId: string, ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  if (node.type === 'group') return <>{renderGroup(node.groupId)}</>;
  const horizontal = node.direction === 'horizontal';
  const style: CSSProperties = {
    display: 'grid',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    position: 'relative',
    background: 'var(--aegis-border)',
    gridTemplateColumns: horizontal ? `${node.ratio * 100}% minmax(0, 1fr)` : undefined,
    gridTemplateRows: horizontal ? undefined : `${node.ratio * 100}% minmax(0, 1fr)`,
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
    const ratio = horizontal
      ? (event.clientX - bounds.left) / bounds.width
      : (event.clientY - bounds.top) / bounds.height;
    onResize(node.id, clampSplitRatio(ratio));
  };

  return (
    <div ref={containerRef} style={style} data-workbench-split={node.id} data-direction={node.direction}>
      <TabGroupLayout node={node.first} renderGroup={renderGroup} onResize={onResize} />
      <TabGroupLayout node={node.second} renderGroup={renderGroup} onResize={onResize} />
      <div
        role="separator"
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        className={`junqi-wb-split-handle is-${node.direction}`}
        style={horizontal ? { left: `${node.ratio * 100}%` } : { top: `${node.ratio * 100}%` }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          resize(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) resize(event);
        }}
        onDoubleClick={() => onResize(node.id, 0.5)}
      />
    </div>
  );
}
