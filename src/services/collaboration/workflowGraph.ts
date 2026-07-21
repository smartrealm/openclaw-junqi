import type { CollaborationWorkItemSnapshot } from './types';

export const WORKFLOW_GRAPH_NODE_WIDTH = 220;
export const WORKFLOW_GRAPH_NODE_HEIGHT = 92;
export const WORKFLOW_GRAPH_COLUMN_GAP = 76;
export const WORKFLOW_GRAPH_ROW_GAP = 22;
export const WORKFLOW_GRAPH_PADDING = 18;

export interface WorkflowGraphNode {
  id: string;
  item: CollaborationWorkItemSnapshot;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface WorkflowGraphEdge {
  id: string;
  from: WorkflowGraphNode;
  to: WorkflowGraphNode;
}

export interface WorkflowGraphProjection {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
  width: number;
  height: number;
}

/**
 * Produces a deterministic, read-only layout for the server-authoritative
 * work-item DAG. Unknown dependencies intentionally render no edge.
 */
export function buildWorkflowGraphProjection(
  items: readonly CollaborationWorkItemSnapshot[],
): WorkflowGraphProjection {
  const itemByLogicalId = new Map<string, CollaborationWorkItemSnapshot>();
  for (const item of items) {
    if (!itemByLogicalId.has(item.logicalId)) itemByLogicalId.set(item.logicalId, item);
  }
  const ids = [...itemByLogicalId.keys()].sort((left, right) => left.localeCompare(right));
  const levels = new Map<string, number>();
  const resolving = new Set<string>();

  const resolveLevel = (logicalId: string): number => {
    const known = levels.get(logicalId);
    if (known !== undefined) return known;
    if (resolving.has(logicalId)) return 0;
    resolving.add(logicalId);
    const item = itemByLogicalId.get(logicalId)!;
    const dependencies = item.dependencies.filter((dependency) => itemByLogicalId.has(dependency));
    const level = dependencies.length === 0
      ? 0
      : Math.max(...dependencies.map((dependency) => resolveLevel(dependency) + 1));
    resolving.delete(logicalId);
    levels.set(logicalId, level);
    return level;
  };

  for (const logicalId of ids) resolveLevel(logicalId);

  const idsByColumn = new Map<number, string[]>();
  for (const logicalId of ids) {
    const column = levels.get(logicalId) ?? 0;
    const columnIds = idsByColumn.get(column) ?? [];
    columnIds.push(logicalId);
    idsByColumn.set(column, columnIds);
  }

  const nodes: WorkflowGraphNode[] = [];
  for (const [column, columnIds] of [...idsByColumn.entries()].sort(([left], [right]) => left - right)) {
    columnIds.sort((left, right) => left.localeCompare(right));
    for (const [row, logicalId] of columnIds.entries()) {
      nodes.push({
        id: logicalId,
        item: itemByLogicalId.get(logicalId)!,
        column,
        row,
        x: WORKFLOW_GRAPH_PADDING + column * (WORKFLOW_GRAPH_NODE_WIDTH + WORKFLOW_GRAPH_COLUMN_GAP),
        y: WORKFLOW_GRAPH_PADDING + row * (WORKFLOW_GRAPH_NODE_HEIGHT + WORKFLOW_GRAPH_ROW_GAP),
      });
    }
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges = nodes.flatMap((node) => node.item.dependencies.flatMap((dependency) => {
    const from = nodesById.get(dependency);
    return from ? [{ id: `${from.id}->${node.id}`, from, to: node }] : [];
  }));
  const columnCount = nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.column)) + 1;
  const rowCount = nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.row)) + 1;

  return {
    nodes,
    edges,
    width: Math.max(
      WORKFLOW_GRAPH_NODE_WIDTH + WORKFLOW_GRAPH_PADDING * 2,
      columnCount * WORKFLOW_GRAPH_NODE_WIDTH + Math.max(0, columnCount - 1) * WORKFLOW_GRAPH_COLUMN_GAP + WORKFLOW_GRAPH_PADDING * 2,
    ),
    height: Math.max(
      WORKFLOW_GRAPH_NODE_HEIGHT + WORKFLOW_GRAPH_PADDING * 2,
      rowCount * WORKFLOW_GRAPH_NODE_HEIGHT + Math.max(0, rowCount - 1) * WORKFLOW_GRAPH_ROW_GAP + WORKFLOW_GRAPH_PADDING * 2,
    ),
  };
}

export function workflowGraphEdgePath(edge: WorkflowGraphEdge): string {
  const fromX = edge.from.x + WORKFLOW_GRAPH_NODE_WIDTH;
  const fromY = edge.from.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
  const toX = edge.to.x;
  const toY = edge.to.y + WORKFLOW_GRAPH_NODE_HEIGHT / 2;
  const bend = Math.max(18, (toX - fromX) / 2);
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
}
