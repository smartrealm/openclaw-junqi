export type BackgroundTaskErrorHandler = (label: string, error: unknown) => void;
export type LifecycleState = "open" | "closing" | "closed";
export type LifecycleTaskFactory<T> = (signal: AbortSignal) => Promise<T>;

export class LifecycleClosedError extends Error {
  readonly code = "LIFECYCLE_CLOSED";

  constructor(readonly state: Exclude<LifecycleState, "open">) {
    super(`Background lifecycle is ${state}`);
    this.name = "LifecycleClosedError";
  }
}

export class LifecycleAbortedError extends Error {
  readonly code = "LIFECYCLE_ABORTED";

  constructor(message = "Background lifecycle is closing") {
    super(message);
    this.name = "LifecycleAbortedError";
  }
}

interface ManagedTimer {
  kind: "interval" | "timeout";
  handle: ReturnType<typeof setTimeout>;
}

export class BackgroundLifecycleSupervisor {
  private readonly controller = new AbortController();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly keyedTasks = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ManagedTimer>();
  private closePromise: Promise<void> | null = null;
  private lifecycleState: LifecycleState = "open";

  constructor(private readonly onError: BackgroundTaskErrorHandler = () => undefined) {}

  get state(): LifecycleState {
    return this.lifecycleState;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get activeTaskCount(): number {
    return this.tasks.size;
  }

  get scheduledTimerCount(): number {
    return this.timers.size;
  }

  run<T>(label: string, factory: LifecycleTaskFactory<T>): Promise<T> {
    return this.createTask(label, factory);
  }

  runOnce<T>(key: string, label: string, factory: LifecycleTaskFactory<T>): Promise<T> {
    const closed = this.closedRejection<T>();
    if (closed) return closed;
    const existing = this.keyedTasks.get(key);
    if (existing) return existing as Promise<T>;
    return this.createTask(
      label,
      factory,
      (task) => this.keyedTasks.set(key, task),
      (task) => {
        if (this.keyedTasks.get(key) === task) this.keyedTasks.delete(key);
      },
    );
  }

  every(
    key: string,
    label: string,
    intervalMs: number,
    factory: LifecycleTaskFactory<void>,
    options: { immediate?: boolean } = {},
  ): () => void {
    this.assertOpen();
    assertDelay(intervalMs, "intervalMs", false);
    this.assertTimerAvailable(key);
    const trigger = () => {
      void this.runOnce(key, label, factory);
    };
    const handle = setInterval(trigger, intervalMs);
    unrefTimer(handle);
    this.timers.set(key, { kind: "interval", handle });
    if (options.immediate) trigger();
    return () => this.cancelTimer(key);
  }

  defer(
    key: string,
    label: string,
    delayMs: number,
    factory: LifecycleTaskFactory<void>,
  ): () => void {
    this.assertOpen();
    assertDelay(delayMs, "delayMs", true);
    this.assertTimerAvailable(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      void this.runOnce(key, label, factory);
    }, delayMs);
    unrefTimer(handle);
    this.timers.set(key, { kind: "timeout", handle });
    return () => this.cancelTimer(key);
  }

  race<T>(operation: Promise<T>): Promise<T> {
    // The underlying operation may settle after shutdown wins the race.
    void operation.catch(() => undefined);
    const closed = this.closedRejection<T>();
    if (closed) return closed;

    let settled = false;
    let resolveResult!: (value: T | PromiseLike<T>) => void;
    let rejectResult!: (error: unknown) => void;
    const result = new Promise<T>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    void result.catch(() => undefined);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      this.signal.removeEventListener("abort", onAbort);
      rejectResult(this.abortReason());
    };
    this.signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener("abort", onAbort);
        resolveResult(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        this.signal.removeEventListener("abort", onAbort);
        rejectResult(error);
      },
    );
    return result;
  }

  sleep(delayMs: number): Promise<void> {
    assertDelay(delayMs, "delayMs", true);
    const closed = this.closedRejection<void>();
    if (closed) return closed;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(handle);
        this.signal.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () => finish(this.abortReason());
      const handle = setTimeout(() => finish(), delayMs);
      unrefTimer(handle);
      this.signal.addEventListener("abort", onAbort, { once: true });
      if (this.signal.aborted) onAbort();
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    let resolveClose!: () => void;
    let rejectClose!: (error: unknown) => void;
    const closing = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    this.closePromise = closing;
    this.lifecycleState = "closing";

    try {
      this.controller.abort(new LifecycleAbortedError());
      for (const key of [...this.timers.keys()]) this.cancelTimer(key);
    } catch (error) {
      this.lifecycleState = "closed";
      rejectClose(error);
      return closing;
    }

    void this.drainTasks().then(
      () => {
        this.lifecycleState = "closed";
        resolveClose();
      },
      (error) => {
        this.lifecycleState = "closed";
        rejectClose(error);
      },
    );
    return closing;
  }

  private createTask<T>(
    label: string,
    factory: LifecycleTaskFactory<T>,
    beforeStart?: (task: Promise<T>) => void,
    afterSettle?: (task: Promise<T>) => void,
  ): Promise<T> {
    const closed = this.closedRejection<T>();
    if (closed) return closed;

    let resolveTask!: (value: T | PromiseLike<T>) => void;
    let rejectTask!: (error: unknown) => void;
    const task = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    beforeStart?.(task);
    this.tasks.add(task);
    void task.then(
      () => {
        this.tasks.delete(task);
        afterSettle?.(task);
      },
      (error) => {
        this.tasks.delete(task);
        afterSettle?.(task);
        this.reportError(label, error);
      },
    );

    try {
      void factory(this.signal).then(resolveTask, rejectTask);
    } catch (error) {
      rejectTask(error);
    }
    return task;
  }

  private closedRejection<T>(): Promise<T> | null {
    if (this.lifecycleState === "open") return null;
    const error = new LifecycleClosedError(this.lifecycleState);
    const rejected = Promise.reject<T>(error);
    void rejected.catch(() => undefined);
    return rejected;
  }

  private assertOpen(): void {
    if (this.lifecycleState !== "open") throw new LifecycleClosedError(this.lifecycleState);
  }

  private assertTimerAvailable(key: string): void {
    if (this.timers.has(key)) throw new Error(`Background timer ${key} is already registered`);
  }

  private cancelTimer(key: string): void {
    const timer = this.timers.get(key);
    if (!timer) return;
    this.timers.delete(key);
    if (timer.kind === "interval") clearInterval(timer.handle);
    else clearTimeout(timer.handle);
  }

  private reportError(label: string, error: unknown): void {
    if (isExpectedAbort(error, this.signal)) return;
    try {
      this.onError(label, error);
    } catch {
      // The lifecycle error boundary must not fail because its observer failed.
    }
  }

  private abortReason(): LifecycleAbortedError {
    return this.signal.reason instanceof LifecycleAbortedError
      ? this.signal.reason
      : new LifecycleAbortedError();
  }

  private async drainTasks(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }
}

export class BackgroundTaskRegistry {
  private readonly tasks = new Set<Promise<void>>();

  constructor(private readonly onError: BackgroundTaskErrorHandler) {}

  track(label: string, task: Promise<void>): Promise<void> {
    let tracked!: Promise<void>;
    tracked = task
      .catch((error) => this.onError(label, error))
      .finally(() => this.tasks.delete(tracked));
    this.tasks.add(tracked);
    return tracked;
  }

  async drain(): Promise<void> {
    while (this.tasks.size > 0) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  get size(): number {
    return this.tasks.size;
  }
}

export class SingleFlight {
  private current: Promise<void> | null = null;

  run(factory: () => Promise<void>): Promise<void> {
    if (this.current) return this.current;
    let resolveTask!: () => void;
    let rejectTask!: (error: unknown) => void;
    const task = new Promise<void>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    let tracked!: Promise<void>;
    tracked = task.finally(() => {
      if (this.current === tracked) this.current = null;
    });
    this.current = tracked;
    // Fire-and-forget callers must not turn a loop failure into an unhandled rejection.
    void tracked.catch(() => undefined);
    try {
      void factory().then(resolveTask, rejectTask);
    } catch (error) {
      rejectTask(error);
    }
    return tracked;
  }

  async drain(): Promise<void> {
    await this.current;
  }

  get active(): boolean {
    return this.current !== null;
  }
}

function assertDelay(value: number, field: string, allowZero: boolean): void {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new RangeError(`${field} must be ${allowZero ? "non-negative" : "positive"}`);
  }
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timer);
  }
}

function isExpectedAbort(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof LifecycleAbortedError) return true;
  if (!signal.aborted || !(error instanceof Error)) return false;
  return error.name === "AbortError";
}
