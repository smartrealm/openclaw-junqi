import { useCallback, useEffect, useState } from 'react';
import {
  CollaborationMaintenanceError,
  collaborationMaintenanceCoordinator,
  type CollaborationMaintenanceStatus,
} from '@/services/collaboration/MaintenanceCoordinator';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Unknown maintenance error');
}

export function useCollaborationMaintenance() {
  const [status, setStatus] = useState<CollaborationMaintenanceStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issue, setIssue] = useState<CollaborationMaintenanceError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await collaborationMaintenanceCoordinator.inspect());
      setError(null);
      setIssue(null);
    } catch (cause) {
      setError(message(cause));
      setIssue(cause instanceof CollaborationMaintenanceError ? cause : null);
    } finally {
      setLoading(false);
    }
  }, []);

  const recover = useCallback(async () => {
    if (recovering) return false;
    setRecovering(true);
    try {
      const result = await collaborationMaintenanceCoordinator.recover();
      setStatus(result.status);
      setError(null);
      setIssue(null);
      return true;
    } catch (cause) {
      setError(message(cause));
      setIssue(cause instanceof CollaborationMaintenanceError ? cause : null);
      try {
        setStatus(await collaborationMaintenanceCoordinator.inspect());
      } catch {
        // Keep the last authoritative status visible when the runtime is unavailable.
      }
      return false;
    } finally {
      setRecovering(false);
    }
  }, [recovering]);

  const runGuarded = useCallback(async <T,>(reason: string, operation: () => Promise<T>): Promise<T> => {
    setError(null);
    setIssue(null);
    try {
      const result = await collaborationMaintenanceCoordinator.runGuarded(reason, operation);
      setStatus(result.release.status);
      return result.value;
    } catch (cause) {
      setError(message(cause));
      setIssue(cause instanceof CollaborationMaintenanceError ? cause : null);
      try {
        setStatus(await collaborationMaintenanceCoordinator.inspect());
      } catch {
        // The thrown coordination error remains the authoritative failure.
      }
      throw cause;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, recovering, error, issue, refresh, recover, runGuarded };
}
