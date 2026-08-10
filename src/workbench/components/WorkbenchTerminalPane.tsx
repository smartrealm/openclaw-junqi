import { useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useResolvedTheme } from '@/theme/useTheme';
import { buildDarkTerminalTheme } from '@/components/Terminal/terminalShared';
import type { WorkbenchTab } from '../domain/types';
import { useWorkbenchStore } from '../store/workbenchStore';
import { detachWorkbenchTerminalView } from './workbenchTerminalViewLifecycle';
import {
  closeWorkbenchPtyTab,
  createWorkbenchPty,
  inputWorkbenchPty,
  resizeWorkbenchPty,
  snapshotWorkbenchPty,
  subscribeWorkbenchPty,
  type WorkbenchPtyIdentity,
} from '../pty/workbenchPtyClient';

export function WorkbenchTerminalPane({ tab, cwd }: { tab: WorkbenchTab; cwd: string }) {
  const acknowledgePtyCreate = useWorkbenchStore((state) => state.acknowledgePtyCreate);
  const replacePtyIdentity = useWorkbenchStore((state) => state.replacePtyIdentity);
  const beginResourceTransaction = useWorkbenchStore((state) => state.beginResourceTransaction);
  const endResourceTransaction = useWorkbenchStore((state) => state.endResourceTransaction);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const resolvedTheme = useResolvedTheme();
  const [error, setError] = useState<string | null>(null);
  const identity = useMemo<WorkbenchPtyIdentity | null>(() => (
    tab.ptyId && tab.ptyRunId ? { ptyId: tab.ptyId, runId: tab.ptyRunId } : null
  ), [tab.ptyId, tab.ptyRunId]);

  useEffect(() => {
    if (!identity || !containerRef.current || !cwd) return;
    let alive = true;
    let subscription: Awaited<ReturnType<typeof subscribeWorkbenchPty>> | null = null;
    let resyncing = false;
    let bufferedOutput: Array<{ sequence: number; data: string }> = [];
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      scrollback: 10_000,
      fontFamily: 'var(--font-mono), ui-monospace, monospace',
      fontSize: 12,
      theme: buildDarkTerminalTheme(),
    });
    terminalRef.current = terminal;
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
      if (resyncing) return null;
      resyncing = true;
      bufferedOutput = [];
      try {
        const snapshot = await snapshotWorkbenchPty(identity);
        if (!alive) return snapshot.sequence;
        terminal.reset();
        if (snapshot.truncated) terminal.write('[earlier output truncated]\r\n');
        terminal.write(snapshot.data);
        let sequence = snapshot.sequence;
        for (const output of bufferedOutput) {
          if (output.sequence <= sequence) continue;
          terminal.write(output.data);
          sequence = output.sequence;
        }
        return sequence;
      } finally {
        bufferedOutput = [];
        resyncing = false;
      }
    };

    void (async () => {
      let sequence = 0;
      try {
        // Subscribe before create so first output cannot race the renderer.
        subscription = await subscribeWorkbenchPty(
          identity,
          (output) => {
            if (resyncing) bufferedOutput.push({ sequence: output.sequence, data: output.data });
            else terminal.write(output.data);
          },
          () => {
            void resync()
              .then((nextSequence) => { if (nextSequence !== null) subscription?.synchronize(nextSequence); })
              .catch(() => undefined);
          },
          () => {
            if (alive) terminal.write('\r\n[process exited]\r\n');
          },
          sequence,
        );
        const created = await createWorkbenchPty(
          identity,
          cwd,
          tab.worktreeId,
          tab.paneId,
          terminal.cols,
          terminal.rows,
          tab.ptyCreatePending === true,
        );
        acknowledgePtyCreate(tab.id);
        if (!alive) return;
        if (created.completed) {
          terminal.write('\r\n[process already exited]\r\n');
        } else if (!created.created) {
          sequence = (await resync()) ?? sequence;
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
      detachWorkbenchTerminalView({ observer, subscription, input, resize, terminal });
      terminalRef.current = null;
      // 隐藏或卸载面板时只断开视图，不主动停止 PTY。
    };
  }, [acknowledgePtyCreate, cwd, identity, tab.id, tab.paneId, tab.ptyCreatePending, tab.worktreeId]);

  // xterm 绘制在画布上，CSS 变量变化不会自动重绘；主题切换后重新读取共享色板，
  // 不重建 PTY，也不丢失滚动历史。
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = buildDarkTerminalTheme();
    terminal.refresh(0, Math.max(0, terminal.rows - 1));
  }, [resolvedTheme]);

  const restart = async () => {
    if (!identity) return;
    const transactionToken = beginResourceTransaction('restart-terminal');
    if (!transactionToken) return;
    try {
      // Retire the exact old identity before authorizing a replacement run.
      await closeWorkbenchPtyTab(identity);
      const next = crypto.randomUUID();
      replacePtyIdentity(tab.id, `workbench:pty:${next}`, `workbench:run:${crypto.randomUUID()}`, transactionToken);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      endResourceTransaction(transactionToken);
    }
  };

  if (!identity) return <div className="junqi-wb-empty-panel">Terminal 标签缺少 PTY identity</div>;
  return (
    <section className="junqi-wb-pane junqi-wb-terminal-pane">
      {error ? (
        <div className="junqi-wb-terminal-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { void restart(); }}>重新启动 Shell</button>
        </div>
      ) : null}
      <div ref={containerRef} className="junqi-wb-xterm" />
    </section>
  );
}
