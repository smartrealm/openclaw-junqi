import { useCallback, useEffect, useRef, useState } from 'react';
import { gateway } from '@/services/gateway';
import type { ArtifactDownloadResult, ArtifactSummary } from '@/services/gateway/artifacts';

interface SessionArtifactsState {
  artifacts: ArtifactSummary[];
  loading: boolean;
  error: string | null;
  downloadingId: string | null;
  downloads: Record<string, ArtifactDownloadResult>;
}

const EMPTY_STATE: SessionArtifactsState = {
  artifacts: [],
  loading: false,
  error: null,
  downloadingId: null,
  downloads: {},
};

export function useSessionArtifacts(
  sessionKey: string,
  agentId: string,
  enabled: boolean,
): SessionArtifactsState & {
  refresh: () => Promise<void>;
  download: (artifact: ArtifactSummary) => Promise<ArtifactDownloadResult | null>;
} {
  const [state, setState] = useState<SessionArtifactsState>(EMPTY_STATE);
  const requestId = useRef(0);
  const normalizedSessionKey = sessionKey.trim();
  const normalizedAgentId = agentId.trim();

  const load = useCallback(async () => {
    if (!normalizedSessionKey) {
      setState({ ...EMPTY_STATE, error: 'OpenClaw session identity is unavailable' });
      return;
    }
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const artifacts = await gateway.listSessionArtifacts(
        normalizedSessionKey,
        normalizedAgentId || undefined,
      );
      if (requestId.current !== currentRequest) return;
      setState((current) => ({ ...current, artifacts, loading: false, error: null }));
    } catch (error) {
      if (requestId.current !== currentRequest) return;
      setState((current) => ({
        ...current,
        artifacts: [],
        downloads: {},
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [normalizedAgentId, normalizedSessionKey]);

  const download = useCallback(async (artifact: ArtifactSummary): Promise<ArtifactDownloadResult | null> => {
    if (artifact.download.mode === 'unsupported') return null;
    const currentRequest = ++requestId.current;
    setState((current) => ({ ...current, downloadingId: artifact.id, error: null }));
    try {
      const result = await gateway.downloadSessionArtifact(
        artifact.id,
        normalizedSessionKey,
        normalizedAgentId || undefined,
      );
      if (requestId.current !== currentRequest) return null;
      setState((current) => ({
        ...current,
        downloadingId: null,
        downloads: { ...current.downloads, [artifact.id]: result },
      }));
      return result;
    } catch (error) {
      if (requestId.current !== currentRequest) return null;
      setState((current) => ({
        ...current,
        downloadingId: null,
        error: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  }, [normalizedAgentId, normalizedSessionKey]);

  useEffect(() => {
    requestId.current += 1;
    setState(EMPTY_STATE);
    if (!enabled) return;
    void load();
    return () => { requestId.current += 1; };
  }, [enabled, load]);

  return { ...state, refresh: load, download };
}
