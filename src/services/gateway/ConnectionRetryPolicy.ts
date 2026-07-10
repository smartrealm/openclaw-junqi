export type RetryDecision =
  | { exhausted: true; attempt: number; maxAttempts: number }
  | { exhausted: false; nextAttempt: number; maxAttempts: number; delayMs: number };

/** Pure retry policy shared by transport execution and UI attempt reporting. */
export class ConnectionRetryPolicy {
  private currentAttempt = 0;

  constructor(
    readonly maxAttempts = 3,
    private readonly baseDelayMs = 1_000,
    private readonly maxDelayMs = 30_000,
  ) {
    if (maxAttempts < 1) throw new Error('maxAttempts must be at least 1');
  }

  get attempt(): number {
    return this.currentAttempt;
  }

  begin(): number {
    this.currentAttempt = 1;
    return this.currentAttempt;
  }

  beginRetry(): number {
    this.currentAttempt = Math.min(this.maxAttempts, this.currentAttempt + 1);
    return this.currentAttempt;
  }

  next(): RetryDecision {
    if (this.currentAttempt >= this.maxAttempts) {
      return { exhausted: true, attempt: this.currentAttempt, maxAttempts: this.maxAttempts };
    }
    return {
      exhausted: false,
      nextAttempt: this.currentAttempt + 1,
      maxAttempts: this.maxAttempts,
      delayMs: Math.min(
        this.baseDelayMs * Math.pow(2, Math.max(0, this.currentAttempt - 1)),
        this.maxDelayMs,
      ),
    };
  }

  reset(): void {
    this.currentAttempt = 0;
  }
}
