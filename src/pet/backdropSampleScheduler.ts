interface BackdropSampleSchedulerOptions<T> {
  intervalMs: number;
  sample: () => Promise<T>;
  publish: (value: T) => void;
  fail?: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (handle: number) => void;
}

export class BackdropSampleScheduler<T> {
  private readonly intervalMs: number;
  private readonly sample: () => Promise<T>;
  private readonly publish: (value: T) => void;
  private readonly fail?: () => void;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => number;
  private readonly clearTimer: (handle: number) => void;
  private lastStartedAt = Number.NEGATIVE_INFINITY;
  private timer: number | null = null;
  private pending = false;
  private inFlight = false;
  private requestRevision = 0;
  private disposed = false;

  constructor(options: BackdropSampleSchedulerOptions<T>) {
    this.intervalMs = Math.max(0, options.intervalMs);
    this.sample = options.sample;
    this.publish = options.publish;
    this.fail = options.fail;
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle));
  }

  request(): void {
    if (this.disposed) return;
    this.requestRevision += 1;
    this.pending = true;
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    this.pending = false;
    if (this.timer != null) this.clearTimer(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.disposed || this.inFlight || this.timer != null || !this.pending) return;
    const delayMs = Math.max(0, this.intervalMs - (this.now() - this.lastStartedAt));
    if (delayMs === 0) {
      this.start();
      return;
    }
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.schedule();
    }, delayMs);
  }

  private start(): void {
    if (this.disposed || this.inFlight || !this.pending) return;
    this.pending = false;
    this.inFlight = true;
    this.lastStartedAt = this.now();
    const startedRevision = this.requestRevision;

    let request: Promise<T>;
    try {
      request = this.sample();
    } catch {
      if (!this.disposed) this.fail?.();
      this.finish();
      return;
    }

    void request.then(
      (value) => {
        // A movement request that arrived while native capture was in flight
        // makes this result stale. Do not flash the previous position's text
        // color before the queued latest-position sample completes.
        if (!this.disposed && startedRevision === this.requestRevision) this.publish(value);
      },
      () => {
        if (!this.disposed) this.fail?.();
      },
    ).finally(() => this.finish());
  }

  private finish(): void {
    this.inFlight = false;
    this.schedule();
  }
}
