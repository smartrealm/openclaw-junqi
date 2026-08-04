export interface DynamicIslandVisibilityIntent<TSnapshot> {
  visible: boolean;
  snapshot: TSnapshot;
  ignorePointerEvents: boolean;
}

interface DynamicIslandVisibilityDependencies<TSnapshot> {
  open: () => Promise<unknown>;
  close: () => Promise<unknown>;
  synchronize: (snapshot: TSnapshot, ignorePointerEvents: boolean) => Promise<unknown>;
}

/** Serializes local window visibility so stale asynchronous opens cannot win. */
export class DynamicIslandVisibilityController<TSnapshot> {
  private intent: DynamicIslandVisibilityIntent<TSnapshot> | null = null;
  private processing = false;
  private disposed = false;
  private idle: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: DynamicIslandVisibilityDependencies<TSnapshot>) {}

  reconcile(intent: DynamicIslandVisibilityIntent<TSnapshot>): void {
    if (this.disposed) return;
    this.intent = intent;
    if (this.processing) return;
    this.processing = true;
    this.idle = this.drain().then((handledIntent) => {
      this.processing = false;
      const pendingIntent = this.intent;
      if (!this.disposed && pendingIntent && pendingIntent !== handledIntent) {
        this.reconcile(pendingIntent);
      }
    });
  }

  whenIdle(): Promise<void> {
    return this.idle;
  }

  dispose(): void {
    this.disposed = true;
  }

  private async drain(): Promise<DynamicIslandVisibilityIntent<TSnapshot> | null> {
    while (!this.disposed && this.intent) {
      const currentIntent = this.intent;
      if (!currentIntent.visible) {
        const closed = await this.run(() => this.dependencies.close());
        if (!closed || this.intent === currentIntent) return currentIntent;
        continue;
      }

      const opened = await this.run(() => this.dependencies.open());
      if (!opened) {
        if (this.intent === currentIntent) return currentIntent;
        continue;
      }
      if (this.intent !== currentIntent) continue;

      const synchronized = await this.run(() => this.dependencies.synchronize(
        currentIntent.snapshot,
        currentIntent.ignorePointerEvents,
      ));
      if (!synchronized || this.intent === currentIntent) return currentIntent;
    }
    return null;
  }

  private async run(operation: () => Promise<unknown>): Promise<boolean> {
    try {
      await operation();
      return true;
    } catch {
      return false;
    }
  }
}
