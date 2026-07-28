import { useEffect, useRef } from 'react';
import { loadWorkbenchSession, saveWorkbenchSession } from './storage';
import { WorkbenchSessionWriter } from './writer';
import { useWorkbenchStore } from '../store/workbenchStore';

const LOCAL_PARTITION = 'local';
const WRITE_DEBOUNCE_MS = 180;

export function useWorkbenchSessionPersistence(): void {
  const writerRef = useRef<WorkbenchSessionWriter | null>(null);
  const hydrationRunRef = useRef(0);

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
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useWorkbenchStore.subscribe((state, previous) => {
      if (!state.writerReady || !writerRef.current?.isReady()) return;
      if (
        state.activeWorktreeId === previous.activeWorktreeId
        && state.activeGroupId === previous.activeGroupId
        && state.layout === previous.layout
        && state.groups === previous.groups
        && state.tabs === previous.tabs
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
