export class NotificationOperationGate {
  private generation = 0;
  private activeMutations = 0;
  private repairRequired = false;

  beginRefresh(): number | null {
    if (this.activeMutations > 0) return null;
    this.generation += 1;
    return this.generation;
  }

  canCommitRefresh(token: number): boolean {
    return this.activeMutations === 0 && token === this.generation;
  }

  beginMutation(): void {
    this.activeMutations += 1;
    this.generation += 1;
  }

  finishMutation(succeeded: boolean): boolean {
    if (!succeeded) this.repairRequired = true;
    this.activeMutations = Math.max(0, this.activeMutations - 1);
    if (this.activeMutations > 0 || !this.repairRequired) return false;
    this.repairRequired = false;
    return true;
  }

  invalidate(): void {
    this.generation += 1;
  }
}
