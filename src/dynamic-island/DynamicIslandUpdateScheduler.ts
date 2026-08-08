export const DYNAMIC_ISLAND_UPDATE_THROTTLE_MS = 100;

interface DynamicIslandUpdateSchedulerDependencies {
  schedule: (callback: () => void, delayMs: number) => number;
  clear: (timer: number) => void;
  publish: () => void;
}

/** 合并高频状态变化，避免流式响应把跨窗口 IPC 推到每个渲染批次。 */
export class DynamicIslandUpdateScheduler {
  private timer: number | null = null;
  private generation = 0;
  private disposed = false;

  constructor(private readonly dependencies: DynamicIslandUpdateSchedulerDependencies) {}

  request(): void {
    if (this.disposed || this.timer !== null) return;
    const generation = ++this.generation;
    this.timer = this.dependencies.schedule(() => {
      if (this.generation !== generation) return;
      this.timer = null;
      if (!this.disposed) this.dependencies.publish();
    }, DYNAMIC_ISLAND_UPDATE_THROTTLE_MS);
  }

  cancel(): void {
    if (this.timer === null) return;
    this.generation += 1;
    this.dependencies.clear(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}
