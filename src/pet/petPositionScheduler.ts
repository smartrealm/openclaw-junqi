export interface PetPoint { x: number; y: number }

export class PetPositionScheduler {
  private latest: PetPoint | null = null;
  private inFlight = false;
  private frame = 0;

  constructor(
    private readonly moveWindow: (point: PetPoint) => Promise<unknown>,
    private readonly scheduleFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
    private readonly cancelFrame: (handle: number) => void = cancelAnimationFrame,
  ) {}

  enqueue(point: PetPoint): void {
    this.latest = point;
    this.schedule();
  }

  flush(): void {
    if (this.inFlight || !this.latest) return;
    const point = this.latest;
    this.latest = null;
    this.inFlight = true;
    void this.moveWindow(point).finally(() => {
      this.inFlight = false;
      if (this.latest) this.schedule();
    });
  }

  cancel(): void {
    this.latest = null;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
  }

  private schedule(): void {
    if (this.inFlight || this.frame) return;
    this.frame = this.scheduleFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }
}
