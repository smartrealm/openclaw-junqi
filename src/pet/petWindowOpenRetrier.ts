export interface PetWindowOpenRetrierOptions {
  open: () => Promise<void>;
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timer: number) => void;
  retryDelayMs: number;
}

/**
 * Retries a failed pet-window open while the owning React effect remains
 * active. Only one request or delayed retry can be in flight at a time.
 */
export function createPetWindowOpenRetrier(options: PetWindowOpenRetrierOptions) {
  let active = false;
  let opening = false;
  let retryTimer: number | null = null;

  const attempt = () => {
    if (!active || opening || retryTimer !== null) return;
    opening = true;
    void options.open()
      .catch(() => {
        if (!active || retryTimer !== null) return;
        retryTimer = options.schedule(() => {
          retryTimer = null;
          attempt();
        }, options.retryDelayMs);
      })
      .finally(() => {
        opening = false;
      });
  };

  return {
    start(): void {
      if (active) return;
      active = true;
      attempt();
    },
    stop(): void {
      active = false;
      if (retryTimer !== null) {
        options.cancel(retryTimer);
        retryTimer = null;
      }
    },
  };
}
