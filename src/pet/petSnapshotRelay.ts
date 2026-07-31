import type { PetState } from './pet-states';

/**
 * Retains the latest authoritative state so a newly-created pet WebView can
 * request the snapshot it missed while its listener was being installed.
 */
export class PetSnapshotRelay {
  private latest: PetState | null = null;

  constructor(private readonly emit: (state: PetState) => void) {}

  publish(state: PetState): void {
    this.latest = state;
    this.emit(state);
  }

  replayLatest(): void {
    if (this.latest) this.emit(this.latest);
  }
}
