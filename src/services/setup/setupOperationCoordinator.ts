export type SetupOperationKind = "node" | "git" | "openclaw" | "docker-image";

export interface SetupOperationCancellationResult {
  accepted: boolean;
  queued: boolean;
}

export type CancelSetupOperationPort = (
  operationId: string,
) => Promise<SetupOperationCancellationResult>;

interface ActiveSetupTransaction {
  runId: number;
  completion: Promise<void>;
  finish: () => void;
}

interface SetupOperationCoordinatorOptions {
  cancelOperation: CancelSetupOperationPort;
  scope?: string;
  onBestEffortCancellationError?: (error: unknown) => void;
}

/** Owns one renderer run, its transaction, and its currently cancellable native call. */
export class SetupOperationCoordinator {
  private activeRun = 0;
  private activeOperationId: string | null = null;
  private activeTransaction: ActiveSetupTransaction | null = null;
  private readonly scope: string;

  constructor(private readonly options: SetupOperationCoordinatorOptions) {
    this.scope = options.scope
      ?? `setup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  beginRun(): number {
    void this.invalidateActiveRun();
    return this.activeRun;
  }

  isRunActive(runId: number): boolean {
    return this.activeRun === runId;
  }

  async runOperation<T>(
    runId: number,
    kind: SetupOperationKind,
    execute: (operationId: string) => Promise<T>,
  ): Promise<T> {
    if (!this.isRunActive(runId)) throw new Error("setup cancelled");
    if (this.activeOperationId) {
      throw new Error("another native setup operation is still active");
    }
    const operationId = `${this.scope}:${runId}:${kind}`;
    this.activeOperationId = operationId;
    try {
      return await execute(operationId);
    } finally {
      if (this.activeOperationId === operationId) this.activeOperationId = null;
    }
  }

  beginTransaction(runId: number): boolean {
    const current = this.activeTransaction;
    if (current?.runId === runId) return true;
    if (current) return false;
    let finish!: () => void;
    const completion = new Promise<void>((resolve) => { finish = resolve; });
    this.activeTransaction = { runId, completion, finish };
    return true;
  }

  finishTransaction(runId: number): void {
    const current = this.activeTransaction;
    if (current?.runId !== runId) return;
    this.activeTransaction = null;
    current.finish();
  }

  /** Fence obsolete renderer writes and request native cancellation without claiming success. */
  invalidateActiveRun(): Promise<void> {
    const operationId = this.activeOperationId;
    const completion = this.activeTransaction?.completion ?? Promise.resolve();
    this.activeRun += 1;
    if (operationId) {
      void this.options.cancelOperation(operationId).catch((error) => {
        this.options.onBestEffortCancellationError?.(error);
      });
    }
    return completion;
  }

  /** Confirm the cancellation IPC, then wait for the owned native cleanup to return. */
  async cancelActiveRun(): Promise<void> {
    const operationId = this.activeOperationId;
    const completion = this.activeTransaction?.completion ?? Promise.resolve();
    this.activeRun += 1;
    if (operationId) await this.options.cancelOperation(operationId);
    await completion;
  }
}
