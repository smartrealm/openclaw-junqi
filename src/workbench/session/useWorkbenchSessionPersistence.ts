import { useEffect, useRef } from 'react';
import { getVoiceWakeStatus } from '@/api/tauri-commands';
import { loadWorkbenchSession, saveWorkbenchSession } from './storage';
import { WorkbenchSessionWriter } from './writer';
import { useWorkbenchStore } from '../store/workbenchStore';
import { stopAllWorkbenchPtys } from '../pty/workbenchPtyClient';
import { checkpointAllLocalEditorDocuments } from '@/workspace-files/services/localEditorDocuments';

const LOCAL_PARTITION = 'local';
const WRITE_DEBOUNCE_MS = 180;

export function useWorkbenchSessionPersistence(): void {
  const writerRef = useRef<WorkbenchSessionWriter | null>(null);
  const hydrationRunRef = useRef(0);
  const closeCheckpointRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const run = ++hydrationRunRef.current;
    let alive = true;
    const writer = new WorkbenchSessionWriter(LOCAL_PARTITION, {
      save: saveWorkbenchSession,
    });
    writerRef.current = writer;

    void loadWorkbenchSession(LOCAL_PARTITION).then((loaded) => {
      if (!alive || run !== hydrationRunRef.current) return;
      writer.enable(loaded.generation);
      useWorkbenchStore.getState().hydrateSession(loaded.snapshot);
    }).catch((error) => {
      if (!alive || run !== hydrationRunRef.current) return;
      useWorkbenchStore.getState().failHydration(error instanceof Error ? error.message : String(error));
    });

    return () => {
      alive = false;
      hydrationRunRef.current += 1;
      if (writerRef.current === writer) writerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      if (disposed) return;
      const window = getCurrentWindow();
      return window.onCloseRequested((event) => {
        const writer = writerRef.current;
        if (!writer?.isReady() || !useWorkbenchStore.getState().writerReady) return;
        event.preventDefault();
        if (closeCheckpointRef.current) return;
        const checkpoint = checkpointAllLocalEditorDocuments()
          .then(() => writer.checkpoint(useWorkbenchStore.getState().sessionSnapshot()))
          .then(() => stopAllWorkbenchPtys())
          .then(async () => {
            const status = await getVoiceWakeStatus().catch(() => null);
            if (status?.listening && status.mode === 'wake_word') {
              await window.hide();
              return;
            }
            await window.destroy();
          })
          .catch(() => {
            useWorkbenchStore.getState().failHydration('Workbench shutdown checkpoint or PTY cleanup failed; close again to retry');
          })
          .finally(() => {
            if (closeCheckpointRef.current === checkpoint) closeCheckpointRef.current = null;
          });
        closeCheckpointRef.current = checkpoint;
      });
    }).then((dispose) => {
      if (!dispose) return;
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(() => {
      // Plain browser tests and non-Tauri renderers do not own native shutdown.
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useWorkbenchStore.subscribe((state, previous) => {
      if (!state.writerReady || !writerRef.current?.isReady()) return;
      if (
        state.activeWorktreeId === previous.activeWorktreeId
        && state.worktrees === previous.worktrees
        && state.forgottenLegacyWorktreeIds === previous.forgottenLegacyWorktreeIds
        && state.activeGroupId === previous.activeGroupId
        && state.layout === previous.layout
        && state.groups === previous.groups
        && state.tabs === previous.tabs
        && state.sidebarMode === previous.sidebarMode
        && state.rightSidebarPanel === previous.rightSidebarPanel
        && state.rightSidebarCollapsed === previous.rightSidebarCollapsed
      ) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const writer = writerRef.current;
        if (!writer?.isReady() || !useWorkbenchStore.getState().writerReady) return;
        void writer.schedule(useWorkbenchStore.getState().sessionSnapshot()).catch(() => {
          // A generation conflict or durable write failure closes the gate.
          useWorkbenchStore.getState().failHydration('Workbench session could not be saved safely');
        });
      }, WRITE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
