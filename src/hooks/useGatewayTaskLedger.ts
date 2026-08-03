import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useVisibleInterval } from './useVisibleInterval';
import { gateway } from '@/services/gateway';
import {
  cancelTask,
  getTask,
  listTasks,
  type OpenClawTaskSummary,
} from '@/services/gateway/taskLedger';

interface GatewayTaskLedgerState {
  loading: boolean;
  tasks: OpenClawTaskSummary[];
  unavailable: boolean;
  cancellingTaskIds: ReadonlySet<string>;
  expandedTaskId: string | null;
  taskDetails: ReadonlyMap<string, OpenClawTaskSummary>;
  inspectingTaskIds: ReadonlySet<string>;
  taskDetailErrors: ReadonlySet<string>;
  refresh: () => Promise<void>;
  inspect: (taskId: string) => Promise<void>;
  cancel: (taskId: string) => Promise<boolean>;
}

export function useGatewayTaskLedger(): GatewayTaskLedgerState {
  const connected = useChatStore((state) => state.connected);
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<OpenClawTaskSummary[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [cancellingTaskIds, setCancellingTaskIds] = useState<ReadonlySet<string>>(new Set());
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskDetails, setTaskDetails] = useState<ReadonlyMap<string, OpenClawTaskSummary>>(new Map());
  const [inspectingTaskIds, setInspectingTaskIds] = useState<ReadonlySet<string>>(new Set());
  const [taskDetailErrors, setTaskDetailErrors] = useState<ReadonlySet<string>>(new Set());
  const generation = useRef(0);
  const detailGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const requestGeneration = ++generation.current;
    if (!connected) {
      setUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const page = await listTasks((method, params) => gateway.call(method, params), { limit: 100 });
      if (requestGeneration !== generation.current) return;
      setTasks(page.tasks);
      setTaskDetails((current) => {
        const next = new Map(current);
        const visibleIds = new Set(page.tasks.map((task) => task.id));
        for (const taskId of next.keys()) {
          if (!visibleIds.has(taskId)) next.delete(taskId);
        }
        for (const task of page.tasks) {
          const previous = next.get(task.id);
          if (previous) next.set(task.id, { ...previous, ...task });
        }
        return next;
      });
      setUnavailable(false);
    } catch {
      if (requestGeneration === generation.current) setUnavailable(true);
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }, [connected]);

  const inspect = useCallback(async (taskId: string) => {
    const normalized = taskId.trim();
    if (!normalized) return;
    if (expandedTaskId === normalized) {
      setExpandedTaskId(null);
      return;
    }
    setExpandedTaskId(normalized);
    if (taskDetails.has(normalized)) return;
    if (!connected) {
      setTaskDetailErrors((current) => new Set([...current, normalized]));
      return;
    }
    if (inspectingTaskIds.has(normalized)) return;

    const requestGeneration = ++detailGeneration.current;
    setInspectingTaskIds((current) => new Set([...current, normalized]));
    setTaskDetailErrors((current) => {
      const next = new Set(current);
      next.delete(normalized);
      return next;
    });
    try {
      const result = await getTask((method, params) => gateway.call(method, params), normalized);
      if (requestGeneration !== detailGeneration.current) return;
      setTaskDetails((current) => {
        const next = new Map(current);
        next.set(normalized, result.task);
        return next;
      });
    } catch {
      if (requestGeneration !== detailGeneration.current) return;
      setTaskDetailErrors((current) => new Set([...current, normalized]));
    } finally {
      setInspectingTaskIds((current) => {
        const next = new Set(current);
        next.delete(normalized);
        return next;
      });
    }
  }, [connected, expandedTaskId, inspectingTaskIds, taskDetails]);

  useEffect(() => {
    detailGeneration.current += 1;
    setExpandedTaskId(null);
    setTaskDetails(new Map());
    setInspectingTaskIds(new Set());
    setTaskDetailErrors(new Set());
  }, [connected]);

  const cancel = useCallback(async (taskId: string) => {
    if (cancellingTaskIds.has(taskId)) return false;
    setCancellingTaskIds((current) => new Set([...current, taskId]));
    try {
      const result = await cancelTask(
        (method, params) => gateway.callPrivileged(method, params),
        taskId,
      );
      if (!result.cancelled) return false;
      if (result.task) {
        setTasks((current) => current.map((task) => task.id === result.task!.id ? result.task! : task));
      }
      await refresh();
      return true;
    } catch {
      return false;
    } finally {
      setCancellingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  }, [cancellingTaskIds, refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useVisibleInterval(() => { void refresh(); }, 30_000, connected, connected);

  return {
    loading,
    tasks,
    unavailable,
    cancellingTaskIds,
    expandedTaskId,
    taskDetails,
    inspectingTaskIds,
    taskDetailErrors,
    refresh,
    inspect,
    cancel,
  };
}
