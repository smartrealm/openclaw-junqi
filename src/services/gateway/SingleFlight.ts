export class SingleFlight<T> {
  private active: Promise<T> | null = null;

  get running(): boolean {
    return this.active !== null;
  }

  run(task: () => Promise<T>): Promise<T> {
    if (this.active) return this.active;

    const current = Promise.resolve().then(task);
    this.active = current;
    const clear = () => {
      if (this.active === current) this.active = null;
    };
    void current.then(clear, clear);
    return current;
  }
}

export const gatewayRestartSingleFlight = new SingleFlight<{
  success: boolean;
  method?: string;
  error?: string;
}>();
