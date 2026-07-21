import { CollaborationError } from "./errors.js";

export const RUNTIME_OPERATIONS = [
  "readOrigin",
  "findManagedFlowByController",
  "createManagedFlow",
  "getManagedFlow",
  "updateManagedFlow",
  "runAgent",
  "findAgentTask",
  "waitForRun",
  "getSessionMessages",
  "cancelRun",
  "appendTranscript",
] as const;

export type RuntimeOperation = typeof RUNTIME_OPERATIONS[number];
export type RuntimeDeadlineValues = Readonly<Record<RuntimeOperation, number>>;

export interface RuntimeDeadlinePolicy {
  readonly values: RuntimeDeadlineValues;
  deadlineMs(operation: RuntimeOperation): number;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_RUNTIME_LABEL_LENGTH = 256;

const DEFAULT_RUNTIME_DEADLINE_VALUES = {
  readOrigin: 15_000,
  findManagedFlowByController: 10_000,
  createManagedFlow: 20_000,
  getManagedFlow: 10_000,
  updateManagedFlow: 20_000,
  runAgent: 20_000,
  findAgentTask: 15_000,
  waitForRun: 35_000,
  getSessionMessages: 15_000,
  cancelRun: 20_000,
  appendTranscript: 20_000,
} as const satisfies RuntimeDeadlineValues;

/** Fixed Strategy used by the Runtime deadline Decorator. */
export class FixedRuntimeDeadlinePolicy implements RuntimeDeadlinePolicy {
  readonly values: RuntimeDeadlineValues;

  constructor(values: RuntimeDeadlineValues) {
    const validated = {} as Record<RuntimeOperation, number>;
    for (const operation of RUNTIME_OPERATIONS) {
      const timeoutMs = values[operation];
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
        throw new RangeError(`${operation} runtime deadline must be a positive timer-safe integer`);
      }
      validated[operation] = timeoutMs;
    }
    this.values = Object.freeze(validated);
  }

  deadlineMs(operation: RuntimeOperation): number {
    return this.values[operation];
  }
}

export const DEFAULT_RUNTIME_DEADLINE_POLICY: RuntimeDeadlinePolicy = Object.freeze(
  new FixedRuntimeDeadlinePolicy(DEFAULT_RUNTIME_DEADLINE_VALUES),
);

export interface RuntimeDeadlineOptions {
  label: string;
  timeoutMs: number;
  signal: AbortSignal;
}

/**
 * Decorates one Runtime call with a lifecycle-aware deadline.
 *
 * The original Promise is always observed after the wrapper settles. This is
 * required because a timed-out Runtime effect can still resolve or reject late.
 */
export function withRuntimeDeadline<T>(
  operation: () => T | PromiseLike<T>,
  options: RuntimeDeadlineOptions,
): Promise<T> {
  const { label, signal, timeoutMs } = options;
  assertRuntimeDeadlineOptions(label, timeoutMs);
  if (signal.aborted) return observedRejection<T>(abortReason(signal));

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (value: T | PromiseLike<T>) => void;
  let rejectResult!: (error: unknown) => void;

  const result = new Promise<T>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Fire-and-forget callers must never create an unhandled wrapper rejection.
  void result.catch(() => undefined);

  const cleanup = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    signal.removeEventListener("abort", onAbort);
  };
  const resolveOnce = (value: T) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveResult(value);
  };
  const rejectOnce = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectResult(error);
  };
  function onAbort(): void {
    rejectOnce(abortReason(signal));
  }

  signal.addEventListener("abort", onAbort, { once: true });
  timer = setTimeout(() => {
    if (signal.aborted) {
      onAbort();
      return;
    }
    rejectOnce(new CollaborationError(
      "RUNTIME_TIMEOUT",
      `Runtime operation ${label} exceeded its ${timeoutMs}ms deadline`,
      { label, timeoutMs },
    ));
  }, timeoutMs);
  unrefTimer(timer);

  if (signal.aborted) {
    onAbort();
    return result;
  }

  let original: PromiseLike<T>;
  try {
    original = Promise.resolve(operation());
  } catch (error) {
    rejectOnce(error);
    return result;
  }
  // Both handlers remain attached after the deadline wins, absorbing late
  // settlement without applying it to domain state a second time.
  void original.then(resolveOnce, rejectOnce);
  return result;
}

function assertRuntimeDeadlineOptions(label: string, timeoutMs: number): void {
  if (label.length === 0 || label.length > MAX_RUNTIME_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new RangeError(`runtime deadline label must contain 1-${MAX_RUNTIME_LABEL_LENGTH} printable characters`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new RangeError("runtime deadline timeoutMs must be a positive timer-safe integer");
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Runtime operation was aborted");
}

function observedRejection<T>(error: unknown): Promise<T> {
  const rejected = Promise.reject<T>(error);
  void rejected.catch(() => undefined);
  return rejected;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    const unref = (timer as { unref?: () => void }).unref;
    if (typeof unref === "function") unref.call(timer);
  }
}
