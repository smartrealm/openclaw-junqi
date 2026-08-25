export interface AgentTreeConnectorRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface AgentTreeConnectorWorkerEntry {
  readonly key: string;
  readonly parentAgentId: string | null;
  readonly rect: AgentTreeConnectorRect | null;
}

export interface AgentTreeConnectorInput {
  readonly containerRect: AgentTreeConnectorRect;
  readonly mainRect: AgentTreeConnectorRect | null;
  readonly agentRects: ReadonlyMap<string, AgentTreeConnectorRect>;
  readonly agentOrder: readonly string[];
  readonly workerEntries: readonly AgentTreeConnectorWorkerEntry[];
}

export interface AgentTreeConnectorPath {
  readonly key: string;
  readonly d: string;
}

export interface AgentTreeConnectorGeometry {
  readonly width: number;
  readonly height: number;
  readonly mainToAgentPaths: readonly AgentTreeConnectorPath[];
  readonly agentToWorkerPaths: readonly AgentTreeConnectorPath[];
}

export interface AgentTreeConnectorScrollMetrics {
  readonly scrollLeft: number;
  readonly scrollTop: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
}

/**
 * 将滚动视口转换成内容坐标系。SVG 覆盖层与卡片同处滚动内容中，
 * 因此原点必须包含当前滚动偏移，宽高也必须覆盖完整内容而非仅覆盖可见视口。
 */
export function resolveAgentTreeConnectorContentRect(
  viewportRect: AgentTreeConnectorRect,
  metrics: AgentTreeConnectorScrollMetrics,
): AgentTreeConnectorRect {
  const left = viewportRect.left - metrics.scrollLeft;
  const top = viewportRect.top - metrics.scrollTop;
  return {
    left,
    top,
    right: left + Math.max(0, metrics.scrollWidth),
    bottom: top + Math.max(0, metrics.scrollHeight),
  };
}

function relCenterX(rect: AgentTreeConnectorRect, container: AgentTreeConnectorRect): number {
  return rect.left - container.left + (rect.right - rect.left) / 2;
}

function relTop(rect: AgentTreeConnectorRect, container: AgentTreeConnectorRect): number {
  return rect.top - container.top;
}

function relBottom(rect: AgentTreeConnectorRect, container: AgentTreeConnectorRect): number {
  return rect.bottom - container.top;
}

function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  return `M ${x1},${y1} L ${x1},${midY} L ${x2},${midY} L ${x2},${y2}`;
}

/**
 * 依据卡片在真实 DOM 中的渲染位置计算连线，而不是假设单行等分布局。
 * 无论 Depth 1/Depth 2 是否因为 flex-wrap 换行，连线都会准确连接实际卡片中心，
 * 不再出现连线与折行后卡片位置脱节的问题。
 */
export function computeAgentTreeConnectorGeometry(
  input: AgentTreeConnectorInput,
): AgentTreeConnectorGeometry {
  const { containerRect, mainRect, agentRects, agentOrder, workerEntries } = input;
  const width = containerRect.right - containerRect.left;
  const height = containerRect.bottom - containerRect.top;

  const mainToAgentPaths: AgentTreeConnectorPath[] = [];
  if (mainRect) {
    const mainX = relCenterX(mainRect, containerRect);
    const mainY = relBottom(mainRect, containerRect);
    for (const agentId of agentOrder) {
      const agentRect = agentRects.get(agentId);
      if (!agentRect) continue;
      const agentX = relCenterX(agentRect, containerRect);
      const agentY = relTop(agentRect, containerRect);
      mainToAgentPaths.push({ key: agentId, d: elbowPath(mainX, mainY, agentX, agentY) });
    }
  }

  const agentToWorkerPaths: AgentTreeConnectorPath[] = [];
  for (const entry of workerEntries) {
    if (!entry.rect) continue;
    const parentRect = (entry.parentAgentId ? agentRects.get(entry.parentAgentId) : undefined) ?? mainRect;
    if (!parentRect) continue;
    const parentX = relCenterX(parentRect, containerRect);
    const parentY = relBottom(parentRect, containerRect);
    const childX = relCenterX(entry.rect, containerRect);
    const childY = relTop(entry.rect, containerRect);
    agentToWorkerPaths.push({ key: entry.key, d: elbowPath(parentX, parentY, childX, childY) });
  }

  return { width, height, mainToAgentPaths, agentToWorkerPaths };
}

export function agentTreeConnectorGeometryEqual(
  left: AgentTreeConnectorGeometry | null,
  right: AgentTreeConnectorGeometry,
): boolean {
  if (!left) return false;
  if (left.width !== right.width || left.height !== right.height) return false;
  if (left.mainToAgentPaths.length !== right.mainToAgentPaths.length) return false;
  if (left.agentToWorkerPaths.length !== right.agentToWorkerPaths.length) return false;
  for (let i = 0; i < left.mainToAgentPaths.length; i += 1) {
    if (left.mainToAgentPaths[i].key !== right.mainToAgentPaths[i].key) return false;
    if (left.mainToAgentPaths[i].d !== right.mainToAgentPaths[i].d) return false;
  }
  for (let i = 0; i < left.agentToWorkerPaths.length; i += 1) {
    if (left.agentToWorkerPaths[i].key !== right.agentToWorkerPaths[i].key) return false;
    if (left.agentToWorkerPaths[i].d !== right.agentToWorkerPaths[i].d) return false;
  }
  return true;
}
