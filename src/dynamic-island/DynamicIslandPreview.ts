export const DYNAMIC_ISLAND_PREVIEW_EVENT = 'dynamic-island:preview';
export const DYNAMIC_ISLAND_PREVIEW_DURATION_MS = 5_400;

interface DynamicIslandPreviewDependencies {
  schedule: (callback: () => void, delayMs: number) => number;
  clear: (timer: number) => void;
  onChange: (active: boolean) => void;
}

/** Owns the bounded local preview state; it never persists a user preference. */
export class DynamicIslandPreview {
  private timer: number | null = null;

  constructor(private readonly dependencies: DynamicIslandPreviewDependencies) {}

  start(): void {
    this.clearTimer();
    this.dependencies.onChange(true);
    this.timer = this.dependencies.schedule(() => {
      this.timer = null;
      this.dependencies.onChange(false);
    }, DYNAMIC_ISLAND_PREVIEW_DURATION_MS);
  }

  stop(): void {
    this.clearTimer();
    this.dependencies.onChange(false);
  }

  dispose(): void {
    this.stop();
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    this.dependencies.clear(this.timer);
    this.timer = null;
  }
}

export function requestDynamicIslandPreview(
  emit: (event: string) => Promise<unknown>,
): Promise<unknown> {
  return emit(DYNAMIC_ISLAND_PREVIEW_EVENT);
}
