import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TerminalPage } from './TerminalPage';
import { debugError } from '@/utils/debugLog';
import { useWorkspaceStore } from '@/stores/workspaceStore';

interface TerminalWindowHandoff {
  shell: {
    id: string;
    generatedTitle: string;
    customTitle?: string;
    cwd?: string;
    proxy?: { summary: string; entries: string[] } | null;
  };
  runId: string;
  snapshot: string;
  sshHost?: string;
}

/**
 * A standalone Kooky-style terminal workspace window.
 *
 * It intentionally skips App's gateway/process boot ownership. The desktop
 * process already owns the transferred PTY; this WebView only adopts it.
 */
export default function TerminalWindowRoot() {
  const [handoff, setHandoff] = useState<TerminalWindowHandoff | null | undefined>(undefined);

  useEffect(() => {
    const receiveHandoff = async () => {
      try {
        const label = getCurrentWindow().label;
        const received = await invoke<TerminalWindowHandoff | null>('take_terminal_window_handoff', { label });
        if (received?.sshHost?.trim()) {
          // Build the matching remote workspace before TerminalPage mounts.
          // The transferred live PTY must never spend a frame in a local pane.
          useWorkspaceStore.getState().createSshWorkspace(received.sshHost);
        }
        setHandoff((current) => received ?? current ?? null);
      } catch (error) {
        debugError('terminal', 'take terminal window handoff failed:', error);
        setHandoff(null);
      }
    };
    void receiveHandoff();
  }, []);

  useEffect(() => {
    if (!handoff) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;
    const stopRetry = () => {
      if (retryTimer !== null) window.clearInterval(retryTimer);
      retryTimer = null;
    };
    const acknowledge = (event: Event) => {
      const shellId = (event as CustomEvent<{ shellId?: unknown }>).detail?.shellId;
      if (shellId === handoff.shell.id) stopRetry();
    };
    const deliver = () => {
      if (cancelled) return;
      window.dispatchEvent(new CustomEvent('junqi:import-terminal-shell', {
        detail: { handoff, replaceExisting: true },
      }));
      attempts += 1;
      if (attempts >= 30) stopRetry();
    };
    window.addEventListener('junqi:terminal-shell-imported', acknowledge);
    // TerminalPage has mounted by the next task; retry protects its own
    // initial workspace resolution without ever duplicating the transferred tab.
    const initialTimer = window.setTimeout(deliver, 0);
    retryTimer = window.setInterval(deliver, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      stopRetry();
      window.removeEventListener('junqi:terminal-shell-imported', acknowledge);
    };
  }, [handoff]);

  if (handoff === undefined) return null;
  return <TerminalPage />;
}
