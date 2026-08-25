import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  agentTreeConnectorGeometryEqual,
  computeAgentTreeConnectorGeometry,
  resolveAgentTreeConnectorContentRect,
  type AgentTreeConnectorGeometry,
  type AgentTreeConnectorRect,
} from './agentTreeConnectorGeometry';

interface AgentTreeConnectorWorker {
  readonly key: string;
  readonly parentAgentId: string | null;
}

interface UseAgentTreeConnectorGeometryOptions {
  readonly agentOrder: readonly string[];
  readonly workers: readonly AgentTreeConnectorWorker[];
}

function readRect(element: HTMLDivElement): AgentTreeConnectorRect {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
}

export function useAgentTreeConnectorGeometry({
  agentOrder,
  workers,
}: UseAgentTreeConnectorGeometryOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainCardRef = useRef<HTMLDivElement>(null);
  const agentCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const workerCardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [geometry, setGeometry] = useState<AgentTreeConnectorGeometry | null>(null);

  const setAgentCardRef = useCallback((agentId: string, element: HTMLDivElement | null) => {
    if (element) agentCardRefs.current.set(agentId, element);
    else agentCardRefs.current.delete(agentId);
  }, []);

  const setWorkerCardRef = useCallback((workerKey: string, element: HTMLDivElement | null) => {
    if (element) workerCardRefs.current.set(workerKey, element);
    else workerCardRefs.current.delete(workerKey);
  }, []);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewportRect = readRect(container);
    const containerRect = resolveAgentTreeConnectorContentRect(viewportRect, {
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      scrollWidth: container.scrollWidth,
      scrollHeight: container.scrollHeight,
    });
    const agentRects = new Map<string, AgentTreeConnectorRect>();
    agentCardRefs.current.forEach((element, agentId) => {
      agentRects.set(agentId, readRect(element));
    });
    const workerEntries = workers.map(({ key, parentAgentId }) => {
      const element = workerCardRefs.current.get(key);
      return {
        key,
        parentAgentId,
        rect: element ? readRect(element) : null,
      };
    });
    const next = computeAgentTreeConnectorGeometry({
      containerRect,
      mainRect: mainCardRef.current ? readRect(mainCardRef.current) : null,
      agentRects,
      agentOrder,
      workerEntries,
    });
    setGeometry((current) => (
      agentTreeConnectorGeometryEqual(current, next) ? current : next
    ));
  }, [agentOrder, workers]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (mainCardRef.current) observer.observe(mainCardRef.current);
    agentCardRefs.current.forEach((element) => observer.observe(element));
    workerCardRefs.current.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [measure]);

  return {
    geometry,
    containerRef,
    mainCardRef,
    setAgentCardRef,
    setWorkerCardRef,
  };
}
