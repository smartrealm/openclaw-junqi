import type { CSSProperties, ReactNode } from 'react';
import type { TabGroupId, TabGroupLayoutNode } from '../domain/types';

export function TabGroupLayout({ node, renderGroup }: {
  node: TabGroupLayoutNode;
  renderGroup: (groupId: TabGroupId) => ReactNode;
}) {
  if (node.type === 'group') return <>{renderGroup(node.groupId)}</>;
  const horizontal = node.direction === 'horizontal';
  const style: CSSProperties = {
    display: 'grid',
    minWidth: 0,
    minHeight: 0,
    width: '100%',
    height: '100%',
    gap: 1,
    background: 'var(--aegis-border)',
    gridTemplateColumns: horizontal ? `${node.ratio * 100}% minmax(0, 1fr)` : undefined,
    gridTemplateRows: horizontal ? undefined : `${node.ratio * 100}% minmax(0, 1fr)`,
  };
  return (
    <div style={style} data-workbench-split={node.id} data-direction={node.direction}>
      <TabGroupLayout node={node.first} renderGroup={renderGroup} />
      <TabGroupLayout node={node.second} renderGroup={renderGroup} />
    </div>
  );
}
