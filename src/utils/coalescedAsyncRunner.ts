export interface CoalescedAsyncRunner {
  run: () => Promise<void>;
  isRunning: () => boolean;
}

export function createCoalescedAsyncRunner(
  task: () => Promise<void>,
): CoalescedAsyncRunner {
  let inFlight: Promise<void> | null = null;
  let runAgain = false;

  const run = (): Promise<void> => {
    if (inFlight) {
      runAgain = true;
      return inFlight;
    }

    const execute = async () => {
      do {
        runAgain = false;
        await task();
      } while (runAgain);
    };
    const tracked = execute().finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };

  return {
    run,
    isRunning: () => inFlight !== null,
  };
}
