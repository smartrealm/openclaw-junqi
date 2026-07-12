export interface PetPoint { x: number; y: number }

const requestBrowserFrame = (callback: FrameRequestCallback): number =>
  window.requestAnimationFrame(callback);

const cancelBrowserFrame = (handle: number): void =>
  window.cancelAnimationFrame(handle);

export class PetPositionScheduler {
  private latest: PetPoint | null = null;
  private inFlight = false;
  private frame = 0;
  private disposed = false;

  constructor(
    private readonly moveWindow: (point: PetPoint) => Promise<unknown>,
    private readonly scheduleFrame: (callback: FrameRequestCallback) => number = requestBrowserFrame,
    private readonly cancelFrame: (handle: number) => void = cancelBrowserFrame,
  ) {}

  enqueue(point: PetPoint): void {
    if (this.disposed) return;
    this.latest = point;
    this.schedule();
  }

  flush(): void {
    if (this.disposed || this.inFlight || !this.latest) return;
    const point = this.latest;
    this.latest = null;
    this.inFlight = true;
    try {
      void this.moveWindow(point).then(
        () => this.finishMove(),
        () => this.finishMove(),
      );
    } catch {
      this.finishMove();
    }
  }

  cancel(): void {
    this.latest = null;
    if (this.frame) this.cancelFrame(this.frame);
    this.frame = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private schedule(): void {
    if (this.inFlight || this.frame) return;
    this.frame = this.scheduleFrame(() => {
      this.frame = 0;
      this.flush();
    });
  }

  private finishMove(): void {
    this.inFlight = false;
    if (!this.disposed && this.latest) this.schedule();
  }
}
