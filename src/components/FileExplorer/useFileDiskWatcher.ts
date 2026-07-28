import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { subscribeTauriEventReady } from "@/utils/tauriEvents";
import { parentPathOf } from "./treeUtils";

const FALLBACK_POLL_MS = 3000;

export function useFileDiskWatcher({
  active,
  filePath,
  projectPath,
  onCheckDisk,
}: {
  active: boolean;
  filePath: string;
  projectPath: string;
  onCheckDisk: () => void;
}): void {
  useEffect(() => {
    if (!active) return;

    const watchedDirectory = parentPathOf(filePath);
    let disposed = false;
    let releaseEvent = () => {};
    let watchRegistered = false;
    let fallbackTimer: number | null = null;

    const checkDisk = () => {
      if (!disposed) onCheckDisk();
    };
    const startFallbackPolling = () => {
      if (disposed || fallbackTimer !== null) return;
      fallbackTimer = window.setInterval(() => {
        if (document.visibilityState === "visible") checkDisk();
      }, FALLBACK_POLL_MS);
    };
    const handleFocus = () => checkDisk();

    window.addEventListener("focus", handleFocus);
    checkDisk();

    void subscribeTauriEventReady<{ dir: string }>("fs-changed", (event) => {
      if (event.payload.dir === watchedDirectory) checkDisk();
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        releaseEvent = unlisten;

        const available = await invoke<boolean>("watch_dir", {
          path: watchedDirectory,
          projectPath,
        });
        if (disposed) {
          if (available) {
            await invoke("unwatch_dir", { path: watchedDirectory }).catch(() => undefined);
          }
          return;
        }

        watchRegistered = available;
        checkDisk();
        if (!available) startFallbackPolling();
      })
      .catch(startFallbackPolling);

    return () => {
      disposed = true;
      releaseEvent();
      window.removeEventListener("focus", handleFocus);
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      if (watchRegistered) {
        void invoke("unwatch_dir", { path: watchedDirectory }).catch(() => undefined);
      }
    };
  }, [active, filePath, onCheckDisk, projectPath]);
}
