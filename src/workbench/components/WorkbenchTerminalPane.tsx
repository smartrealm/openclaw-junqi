import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { WorkbenchTab } from '../domain/types';
import { useWorkbenchStore } from '../store/workbenchStore';
import {
  createWorkbenchPty,
  inputWorkbenchPty,
  resizeWorkbenchPty,
  snapshotWorkbenchPty,
  subscribeWorkbenchPty,
  type WorkbenchPtyIdentity,
} from '../pty/workbenchPtyClient';

export function WorkbenchTerminalPane({ tab, cwd }: { tab: WorkbenchTab; cwd: string }) {
  const acknowledgePtyCreate = useWorkbenchStore((state) => state.acknowledgePtyCreate);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const identity = useMemo<WorkbenchPtyIdentity | null>(() => (
    tab.ptyId && tab.ptyRunId ? { ptyId: tab.ptyId, runId: tab.ptyRunId } : null
  ), [tab.ptyId, tab.ptyRunId]);

  useEffect(() => {
    if (!identity || !containerRef.current || !cwd) return;
    let alive = true;
    let subscription: Awaited<ReturnType<typeof subscribeWorkbenchPty>> | null = null;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 10_000,
      fontFamily: 'var(--font-mono), ui-monospace, monospace',
      fontSize: 12,
      theme: { background: '#171b24', foreground: '#d6dbe8', cursor: '#8fa5ff' },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    const input = terminal.onData((data) => {
      void inputWorkbenchPty(identity, data).catch((reason) => {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      });
    });
    const resize = terminal.onResize(({ cols, rows }) => {
      void resizeWorkbenchPty(identity, cols, rows).catch(() => undefined);
    });

    const resync = async () => {
      const snapshot = await snapshotWorkbenchPty(identity);
      if (!alive) return snapshot.sequence;
      terminal.reset();
      terminal.write(snapshot.data);
      return snapshot.sequence;
    };

    void (async () => {
      let sequence = 0;
      try {
        // Subscribe before create so first output cannot race the renderer.
        subscription = await subscribeWorkbenchPty(
          identity,
          (output) => terminal.write(output.data),
          () => {
            void resync()
              .then((nextSequence) => subscription?.synchronize(nextSequence))
              .catch(() => undefined);
          },
          () => { if (alive) terminal.write('\r\n[process exited]\r\n'); },
          sequence,
        );
        const created = await createWorkbenchPty(
          identity,
          cwd,
          terminal.cols,
          terminal.rows,
          tab.ptyCreatePending === true,
        );
        acknowledgePtyCreate(tab.id);
        if (!alive) return;
        if (created.completed) {
          terminal.write('\r\n[process already exited]\r\n');
        } else if (!created.created) {
          sequence = await resync();
          subscription?.synchronize(sequence);
        }
        setError(null);
      } catch (reason) {
        if (alive) setError(reason instanceof Error ? reason.message : String(reason));
      }
    })();

    const observer = new ResizeObserver(() => {
      if (!alive) return;
      try { fit.fit(); } catch { /* pane can be parked at zero size */ }
    });
    observer.observe(containerRef.current);
    return () => {
      alive = false;
      observer.disconnect();
      subscription?.dispose();
      input.dispose();
      resize.dispose();
      terminal.dispose();
      // Deliberately do not stop the PTY: hidden/unmounted panes detach only.
    };
  }, [acknowledgePtyCreate, cwd, identity, tab.id, tab.ptyCreatePending]);

  if (!identity) return <div className="junqi-wb-empty-panel">Terminal 标签缺少 PTY identity</div>;
  return (
    <section className="junqi-wb-pane junqi-wb-terminal-pane">
      {error ? <div className="junqi-wb-terminal-error" role="alert">{error}</div> : null}
      <div ref={containerRef} className="junqi-wb-xterm" />
    </section>
  );
}
